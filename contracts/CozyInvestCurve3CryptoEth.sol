// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/utils/Address.sol";
import "./interfaces/ICozy.sol";
import "./interfaces/ICozyInvest.sol";
import "./utils/TransferHelper.sol";

interface ICrvDepositZap {
  function add_liquidity(
    uint256[3] calldata amounts,
    uint256 minMintAmount,
    address receiver
  ) external payable returns (uint256);

  function remove_liquidity_one_coin(
    uint256 amount,
    uint256 index,
    uint256 minAmount,
    address receiver
  ) external returns (uint256);

  function token() external view returns (address);
}

interface ICrvGauge {
  function claim_rewards(address owner, address receiver) external;

  function deposit(uint256 amount) external;

  function withdraw(uint256 amount) external;
}

/**
 * @notice On-chain scripts for borrowing from a Cozy Curve 3Crypto Trigger protection market or
 * ETH money market and using that ETH to add liquidity to the Curve tricrypto USDT/WBTC/WETH pool
 * @dev This contract is intended to be used by delegatecalling to it from a DSProxy
 */
contract CozyInvestCurve3CryptoEth {
  using Address for address payable;
  using TransferHelper for IERC20;

  /// @notice Cozy protection market with ETH underlying to borrow from: Curve 3Crypto Trigger
  address public immutable protectionMarket;

  /// @notice Cozy money market with ETH underlying
  address public immutable moneyMarket;

  /// @notice Curve tricrypto Deposit Zap -- helper contract for wrapping ETH before depositing
  ICrvDepositZap public immutable depositZap;

  /// @notice Curve tricrypto Liquidity Gauge -- contract for measuring liquidity provided over time
  /// and distributing reward tokens
  ICrvGauge public immutable gauge;

  /// @notice Curve tricrypto receipt token
  IERC20 public immutable curveLpToken;

  /// @notice Maximillion contract for repaying ETH debt
  IMaximillion public immutable maximillion;

  /// @dev Index of WETH in the curve `coins` mapping
  uint256 internal constant ethIndex = 2;

  constructor(
    address _moneyMarket,
    address _protectionMarket,
    address _maximillion,
    address _depositZap,
    address _gauge
  ) {
    moneyMarket = _moneyMarket;
    protectionMarket = _protectionMarket;
    maximillion = IMaximillion(_maximillion);
    gauge = ICrvGauge(_gauge);

    depositZap = ICrvDepositZap(_depositZap);
    curveLpToken = IERC20(depositZap.token());
  }

  /**
   * @notice Protected invest method for borrowing from given cozy ETH market,
   * and using that ETH to add liquidity to the Curve tricrypto pool
   * @param _ethMarket Address of the market to borrow ETH from
   * @param _borrowAmount Amount of ETH to borrow and deposit into Curve
   * @param _curveMinAmountOut The minAmountOut we expect to receive when adding liquidity to Curve
   */
  function invest(
    address _ethMarket,
    uint256 _borrowAmount,
    uint256 _curveMinAmountOut
  ) external payable {
    require(_ethMarket == moneyMarket || _ethMarket == protectionMarket, "Invalid borrow market");
    ICozyEther _market = ICozyEther(_ethMarket);

    // Borrow ETH from Cozy market. The return value from this method is an error code,
    // where a value of zero indicates no error (i.e. the borrow was successful)
    require(_market.borrow(_borrowAmount) == 0, "Borrow failed");

    // Add liquidity to Curve, which gives the caller a receipt token and returns the amount of receipt tokens received
    uint256 _balance = depositZap.add_liquidity{value: _borrowAmount}(
      [0, 0, _borrowAmount],
      _curveMinAmountOut,
      address(this)
    );

    // Approve the Curve tricrypto liquidity gauge to spend our receipt tokens. We need this allowance check first
    // because the Curve token requires that there is zero allowance when calling `approve`
    if (curveLpToken.allowance(address(this), address(depositZap)) == 0) {
      // Approve the Curve tricrypto liquidity gauge to spend our receipt tokens using the safeApprove method.
      // As per EIP-20, allowance is set to 0 first to prevent attack vectors on the approve method
      // (https://eips.ethereum.org/EIPS/eip-20#approve). This is explicitly required by some ERC20 tokens, such as USDT.
      curveLpToken.safeApprove(address(gauge), type(uint256).max);
    }

    // Deposit lp tokens in to liquidity gauge to earn reward tokens
    gauge.deposit(_balance);
  }

  /**
   * @notice Protected divest method for closing a position opened using this contract's `invest` method
   * @param _ethMarket Address of the market to repay ETH to
   * @param _recipient Address where any leftover ETH should be transferred
   * @param _redeemAmount Amount of Curve receipt tokens to redeem
   * @param _curveMinAmountOut The minAmountOut we expect to receive when removing liquidity from Curve
   */
  function divest(
    address _ethMarket,
    address _recipient,
    uint256 _redeemAmount,
    uint256 _curveMinAmountOut
  ) external payable {
    require(_ethMarket == moneyMarket || _ethMarket == protectionMarket, "Invalid borrow market");

    ICozyEther _market = ICozyEther(_ethMarket);

    // Withdraw lp tokens from liquidity gauge
    gauge.withdraw(_redeemAmount);

    // Approve Curve's depositZap to spend our receipt tokens. We need this allowance check first because
    // the Curve token requires that there is zero allowance when calling `approve`.
    if (curveLpToken.allowance(address(this), address(depositZap)) == 0) {
      // Approve Curve's depositZap to spend our receipt tokens using using the safeApprove method.
      curveLpToken.safeApprove(address(depositZap), type(uint256).max);
    }

    // Withdraw from Curve
    depositZap.remove_liquidity_one_coin(_redeemAmount, ethIndex, _curveMinAmountOut, address(this));

    // Pay back as much of the borrow as possible, excess ETH is refunded to `recipient`. Maximillion handles
    // error codes when repayment is unsuccessful.
    maximillion.repayBehalfExplicit{value: address(this).balance}(address(this), _market);

    // Transfer any remaining funds to the user
    payable(_recipient).sendValue(address(this).balance);

    // Claim reward tokens from liquidity gauge and transfer to the user
    claimRewards(_recipient);
  }

  /**
   * @notice Method to claim reward tokens from Curve and transfer to recipient
   * @param _recipient Address of the owner's wallet
   */
  function claimRewards(address _recipient) public {
    gauge.claim_rewards(address(this), _recipient);
  }
}
