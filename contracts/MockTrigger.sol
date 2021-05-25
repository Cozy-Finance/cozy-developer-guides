// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.4;

import "./ITrigger.sol";

contract MockTrigger is ITrigger {
  /// @notice If true, checkAndToggleTrigger will toggle the trigger on its next call
  bool public shouldToggle;

  constructor(
    string memory _name,
    string memory _symbol,
    string memory _description,
    uint256[] memory _platformIds,
    address _recipient,
    bool _shouldToggle
  ) ITrigger(_name, _symbol, _description, _platformIds, _recipient) {
    shouldToggle = _shouldToggle;

    // Verify market is not already triggered.
    require(!isMarketTriggered(), "Already triggered");
  }

  /**
   * @notice Special function for this mock trigger to set whether or not the trigger should toggle
   */
  function setShouldToggle(bool _shouldToggle) external {
    require(!isTriggered, "Cannot set after trigger event");
    shouldToggle = _shouldToggle;
  }

  /**
   * @notice Returns true if the market has been triggered, false otherwise
   */
  function isMarketTriggered() internal view returns (bool) {
    return shouldToggle;
  }

  /**
   * @notice Checks trigger condition, sets isTriggered flag to true if condition is met, and
   * returns the trigger status
   * @dev For this mock trigger, there is no condition to check, so it just returns isTriggered
   */
  function checkAndToggleTrigger() external override returns (bool) {
    // Short circuit if trigger already toggled
    if (isTriggered) return true;

    // Return false if market has not been triggered
    if (!isMarketTriggered()) return false;

    // Otherwise, market has been triggered
    emit TriggerActivated();
    isTriggered = true;
    return isTriggered;
  }
}
