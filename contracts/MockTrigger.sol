// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.3;

import "./TriggerInterface.sol";

contract MockTrigger is TriggerInterface {
  /// @notice True if trigger condition has been met
  bool public override isTriggered;

  /// @notice Trigger name
  string public override name;

  /// @notice Trigger symbol
  string public override symbol;

  /// @notice Trigger description
  string public override description;

  /// @notice IDs of platforms covered by this trigger
  uint256[] public platformIds;

  /// @notice Subsidy recipient
  address public override recipient;

  /// @notice Emitted when the trigger is activated
  event TriggerActivated();

  constructor(
    string memory _name,
    string memory _symbol,
    string memory _description,
    uint256[] memory _platformIds,
    address _recipient
  ) {
    name = _name;
    description = _description;
    symbol = _symbol;
    platformIds = _platformIds;
    recipient = _recipient;
  }

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

  /**
   * @notice Returns array of platform IDs covered by this trigger
   */
  function getPlatformIds() external view override returns (uint256[] memory) {
    return platformIds;
  }
}
