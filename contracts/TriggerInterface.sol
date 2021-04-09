// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.3;

/**
 * @notice Abstract contract for creating or interacting with a Trigger contract
 * @dev All trigger contracts created must inerit from this contract and conform to this interface
 */
abstract contract TriggerInterface {
  /// @notice Trigger name, analgous to an ERC-20 token's name
  string public name;

  /// @notice Trigger symbol, analgous to an ERC-20 token's symbol
  string public symbol;

  /// @notice Trigger description
  string public description;

  /// @notice Array of IDs of platforms covered by this trigger
  uint256[] public platformIds;

  /// @notice Returns address of recipient who receives subsidies for creating a protection market using this trigger
  address public immutable recipient;

  /// @notice Returns true if trigger condition has been met
  bool public isTriggered;

  /// @notice Emitted when the trigger is activated
  event TriggerActivated();

  /// @notice Returns array of IDs, where each ID corresponds to a platform covered by this trigger
  /// @dev See documentation for mapping of ID numbers to platforms
  function getPlatformIds() external view returns (uint256[] memory) {
    return platformIds;
  }

  /// @notice Checks trigger condition, sets isTriggered flag to true if condition is met, and returns isTriggered
  function checkAndToggleTrigger() external virtual returns (bool);

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
}
