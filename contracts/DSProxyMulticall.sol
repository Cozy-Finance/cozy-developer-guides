// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.4;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/ICozy.sol";

/**
 * @notice Enables batched calls to be formed client-side for execution by a DSProxy
 *
 * @dev This contract is intended to be deployed once and used as the `target` address of a DSProxy's
 * `execute(address,bytes)` method. The address passed would be the address of this contract, and the
 * bytes are the encoded array of calls for use with this contract's `batchCalls` method.
 *
 * Typical DSProxy usage works as follows:
 *   1. Deploy a "script" contract, which has one method that batches `n` contract calls
 *   2. User calls `execute()` on their DSProxy and passes the target address and encoded calldata
 *   3. The DSProxy delegatecalls to the script, so each contract call in the script is executed within the
 *      the context of the DSProxy (i.e. as if the DSProxy was directly calling those methods)
 *
 * One downside of the above workflow is that it requires a new script contract to be deployed for each
 * sequence of calls that are batched. This DSProxyMulticall is a solution for that. Usage works as follows:
 *   1. Deploy the DSProxyMulticall contracts
 *   2. Encoded any sequence of `n` calls, then encode those calls to be passed to `execute()`
 *   3. User calls `execute()` on their DSProxy and passes this contract's address and encoded calldata
 *   4. The DSProxy delegatecalls to this contract, so each contract call in the script is executed within the
 *      the context of the DSProxy (i.e. as if the DSProxy was directly calling those methods)
 *
 * This can be useful sometimes, as it saves the cost and work required to deploy a new workflow for each sequence
 * of batched transactions. There are two downsides to this approach:
 *   1. Increased calldata costs may outweigh deployment costs in some cases, so keep that in mind when determining
 *      whether to use a script vs. the DSProxyMulticall
 *   2. Unlike scripts, there is no way to include "dynamic" data in your calldata, e.g. you can't encode
 *      "transfer all DAI from my DSProxy to address Y" if you don't know the DAI balance beforehand. For example
 *      the following sequence of calls cannot be batched:
 *        1. DSProxy calls a lottery contract that will either take 3 DAI or give me 10 DAI
 *        2. DSProxy transfers all remaining DAI in the proxy to address Y
 *
 * We solve the above problem with the addition of functions included in the "Helper Methods" section of this contract,
 * which contains helper methods to enable you to encode logic such as "transfer the full balance" in your calldata.
 * Ultimately, those methods rely on requiring `address(this)` to refer to the DSProxy, but during normal
 * circumstances any method in our batched, encoded calldata that uses `address(this)` would be referring to the
 * `_calls[i].target` address because of the fact that the method is executed with `.call()`.
 *
 * Therefore we defined a special address, called the DELEGATECALL_ADDRESS, which is
 * 0x0xde1Ede1Ede1eDE1edE1edE1EdE1EDE1EDe1EdE1ejust (`de1e` repeating,  since de1e is the first 4 letters of
 * delegatecall). When the `target` address of a call equals the DELEGATECALL_ADDRESS, the DSProxyMulticall uses a
 * .delegatecall() instead of a .call(). As a result, any method executed with `target == DELEGATECALL_ADDRESS` will
 * have `address(this)` within that call refer to the DSProxy's address and it since it will be executing within
 * the DSProxy's context.
 *
 * Now, for any special circumstance that needs to dynamically take some action based on a runtime value dependent on
 * `address(this)`, we can add a helper method, and configure our call with the target set to the DELEGATECALL_ADDRESS
 * and the data encoded to call that method. For example, a call to `transferAll()` can be encoded to transfer
 * all tokens of address `_token` to recipient `_to`, without requiring the caller to know the balance of the DSProxy
 * at the time of encoding the call.
 *
 * Some use cases of these helper methods include a flow such as (1) user sends ETH to proxy wallet, and (2) proxy
 * wallet uses that ETH to pay back debt, then (3) proxy wallet transfers leftover ETH back to user. Because all
 * methods are executed in the context of the DSProxy, they must be `payable` to support being included in a
 * transaction with a non-zero msg.value. As a result, all helper methods are given this modifier to ensure they can
 * always be batched, even if it's not explicitly needed for that method.
 *
 * @dev TODO Confirm there is no security risk or other undesired behavior that can occur due to payable multicall?
 * Read more at: https://github.com/Uniswap/uniswap-v3-periphery/issues/52
 *
 * Potential issue is that when a contract has a built in multicall that delegatecalls, the msg.value
 * used in each delegatecall is the same. So for example, if WETH had a multicall built in, you could
 * send 1 ETH as msg.value, call deposit() 3 times in the multicall, and receive 3 WETH.
 *
 * It seems there is not an issue here because:
 *   1. None of the helper methods that can be delegatecalled to use msg.value
 *   2. Even if so, the context here is that we're in the user's own DSProxy contract, so all funds held
 *      by it are owned by the user. So no funds can be lost or stolen
 */
contract DSProxyMulticall {
  using SafeERC20 for IERC20;
  using Address for address payable;

  /// @notice Placeholder address to represent ETH
  address public constant ETH_ADDRESS = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;

  /// @notice Special address to flag when a call should be executed in the calling DSProxy's context
  address public constant DELEGATECALL_ADDRESS = 0xde1Ede1Ede1eDE1edE1edE1EdE1EDE1EDe1EdE1e;

  /// @notice Address of this contract, used internall when DELEGATECALL_ADDRESS is passed as the target
  address public immutable MULTICALL_ADDRESS;

  /// @notice Required parameters for each call
  struct Call {
    address target; // target contract
    bytes data; // calldata to send on call to target contract
    uint256 value; // value to send with the call
    bool requireSuccess; // true if whole tx should revert on failure, false if we ignore when this call fails
  }

  /// @notice When a call fails, but has requireSuccess as false, emit a failure log with the call's index
  event CallFailed(uint256 index);

  constructor() {
    // Save off the address of this contract to faciliate delegatecalls
    MULTICALL_ADDRESS = address(this);
  }

  /**
   * @notice Batches a sequence of calls into one transaction
   * @dev Based on the Multicall contract: https://github.com/makerdao/multicall
   * @dev While not relevant to this specific contract, please be aware of the following vulnerability
   * with payable multicalls: https://github.com/Uniswap/uniswap-v3-periphery/issues/52
   * @param _calls Array of calls to execute
   */
  function batchCalls(Call[] memory _calls) external payable returns (bytes[] memory) {
    bytes[] memory _returnData = new bytes[](_calls.length);
    for (uint256 i = 0; i < _calls.length; i++) {
      bool _success; // true if call was successful
      bytes memory _response; // data returned from the call

      // See comments at the top of this file for more information on how this if/else block works and how it's
      // intended to be used
      if (_calls[i].target == DELEGATECALL_ADDRESS) {
        // If target address equals the special delegatecall address, this call is trying to execute one of the helper
        // methods within the context of the DSProxy. Therefore we use delegatecall to continue operating on the
        // DSProxy's context. This is required so statements like `address(this)` in a helper method refer to the
        // DSProxy's address, intead of this contract's address. When this branch is used, our call flow is:
        //   1. User calls their DSProxy
        //   2. DSProxy delegatecalls to this contract
        //   3. This contract delegatecalls to itself to execute the specified method in the DSProxy's context
        require(_calls[i].value == 0, "Cannot send value with delegatecall");
        (_success, _response) = MULTICALL_ADDRESS.delegatecall(_calls[i].data);
      } else {
        // Otherwise, execute a regular call on the target contract. When this branch is used, our call flow is:
        //   1. User calls their DSProxy
        //   2. DSProxy delegatecalls to this contract
        //   3. This contract calls the target contract
        (_success, _response) = _calls[i].target.call{value: _calls[i].value}(_calls[i].data);
      }

      // Handle result as needed
      if (!_success && _calls[i].requireSuccess) {
        revert(getRevertMessage(_response));
      } else if (!_success) {
        emit CallFailed(i);
      }
      _returnData[i] = _response;
    }
    return _returnData;
  }

  /**
   * @notice Helper method to get revert message from failed calls
   * @dev References:
   *   - https://github.com/Uniswap/uniswap-v3-periphery/blob/main/contracts/base/Multicall.sol
   *   - https://ethereum.stackexchange.com/a/83577
   * @param _returnData Response of the call
   * @return Revert message string
   */
  function getRevertMessage(bytes memory _returnData) private pure returns (string memory) {
    // If the _res length is less than 68, then the transaction failed silently (without a revert message)
    if (_returnData.length < 68) {
      return "Transaction reverted silently";
    }

    assembly {
      // Slice the sighash.
      _returnData := add(_returnData, 0x04)
    }
    return abi.decode(_returnData, (string)); // All that remains is the revert string
  }

  // ================================================= HELPER METHODS ==================================================

  /**
   * @notice Helper method to transfer the full balance of `_token` to a recipient
   * @dev Uses SafeERC20.safeTransfer() to ensure it throws on failure
   * @dev See comments at the top of this file for more information on how to use this method in a batched call
   * @dev This method is `payable` for compatibility with batching (see comments at the top of this file for more info)
   * @param _token Address of token to transfer
   * @param _to Address to transfer token to
   */
  function transferAll(address _token, address _to) external payable {
    if (_token == ETH_ADDRESS) {
      // Send all ETH
      payable(_to).sendValue(address(this).balance);
    } else {
      // Send all tokens
      IERC20(_token).safeTransfer(_to, IERC20(_token).balanceOf(address(this)));
    }
  }

  /**
   * @notice Helper method to use all tokens in the DSProxy to repay as much cozyToken debt as possible
   * @dev Market must have a token as the underlying
   * @dev This method is `payable` for compatibility with batching (see comments at the top of this file for more info)
   * @dev If this fails, parse the error logs for `Failure` events for additional info on why it failed
   * @param _market Market to repay debt for
   */
  function repayBorrowCozyToken(ICozyToken _market) external payable {
    address _underlying = _market.underlying();
    require(_underlying != ETH_ADDRESS, "Attempted to repay ETH market");

    // Attempt to repay the entire debt
    try _market.repayBorrowBehalf(address(this), type(uint256).max) returns (uint256 _err) {
      if (_err == 0) return; // success! all debt repaid
    } catch {
      // If that failed with a revert, do nothing and fall through to the next statement
    }
    // Repaying the max debt failed, repay as much debt as possible from the DSProxy's balance
    uint256 _err2 = _market.repayBorrowBehalf(address(this), IERC20(_underlying).balanceOf(address(this)));
    require(_err2 == 0, "Repay attempts failed");
  }

  /**
   * @notice Helper method to use all ETH in the DSProxy to repay as much cozyETH debt as possible
   * @dev Market must have ETH as the underlying
   * @dev This is `payable` to support sending the DSProxy ETH and using it to repay the debt in the same transaction
   * @dev If this fails, parse the error logs for `Failure` events for additional info on why it failed
   * @param _market Market to repay debt for
   * @param _maximillion Address of the Maximillion helper contract
   */
  function repayBorrowCozyEther(ICozyEther _market, IMaximillion _maximillion) external payable {
    address _underlying = _market.underlying();
    require(_underlying == ETH_ADDRESS, "Attempted to repay token market");

    // Repay as much cozyETH debt as possible
    _maximillion.repayBehalfExplicit{value: address(this).balance}(address(this), _market);
  }
}
