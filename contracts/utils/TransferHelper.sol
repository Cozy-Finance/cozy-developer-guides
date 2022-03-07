// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @dev Based on https://github.com/Uniswap/v3-periphery/blob/80f26c86c57b8a5e4b913f42844d4c8bd274d058/contracts/libraries/TransferHelper.sol
 */
library TransferHelper {
  /**
   * @notice Transfers tokens from the targeted address to the given destination
   * @notice Errors with 'STF' if transfer fails
   * @param token The token to be transferred
   * @param from The originating address from which the tokens will be transferred
   * @param to The destination address of the transfer
   * @param value The amount to be transferred
   */
  function safeTransferFrom(
    IERC20 token,
    address from,
    address to,
    uint256 value
  ) internal {
    (bool success, bytes memory data) = address(token).call(
      abi.encodeWithSelector(IERC20.transferFrom.selector, from, to, value)
    );
    require(success && (data.length == 0 || abi.decode(data, (bool))), "Transfer from failed");
  }

  /**
   * @notice Transfers tokens from msg.sender to a recipient
   * @dev Errors with ST if transfer fails
   * @param token The token which will be transferred
   * @param to The recipient of the transfer
   * @param value The value of the transfer
   */
  function safeTransfer(
    IERC20 token,
    address to,
    uint256 value
  ) internal {
    (bool success, bytes memory data) = address(token).call(abi.encodeWithSelector(IERC20.transfer.selector, to, value));
    require(success && (data.length == 0 || abi.decode(data, (bool))), "Transfer failed");
  }

  /**
   * @notice Approves the stipulated contract to spend the given allowance in the given token
   * @dev Errors with 'SA' if transfer fails
   * @param token The token to be approved
   * @param to The target of the approval
   * @param value The amount of the given token the target will be allowed to spend
   */
  function safeApprove(
    IERC20 token,
    address to,
    uint256 value
  ) internal {
    (bool success, bytes memory data) = address(token).call(abi.encodeWithSelector(IERC20.approve.selector, to, value));
    require(success && (data.length == 0 || abi.decode(data, (bool))), "Approve failed");
  }
}
