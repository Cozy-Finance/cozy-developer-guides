// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.3;

import "./TriggerInterface.sol";

contract MockTrigger is TriggerInterface {
  constructor(
    string memory _name,
    string memory _symbol,
    string memory _description,
    uint256[] memory _platformIds,
    address _recipient
  ) TriggerInterface(_name, _symbol, _description, _platformIds, _recipient) {}

  /**
   * @notice Checks trigger condition, sets isTriggered flag to true if condition is met, and
   * returns the trigger status
   * @dev For this mock trigger, there is no condition to check, so it just returns isTriggered
   */
  function checkAndToggleTrigger() external override returns (bool) {
    if (isTriggered) return true;
    isTriggered = !isTriggered;
    emit TriggerActivated();
    return isTriggered;
  }
}
