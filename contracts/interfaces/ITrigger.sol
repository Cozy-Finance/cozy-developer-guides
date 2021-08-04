pragma solidity ^0.8.5;

/**
 * @notice Abstract contract for creating or interacting with a Trigger contract
 * @dev All trigger contracts created must inherit from this contract and conform to this interface
 */
abstract contract ITrigger {
  /// @notice Trigger name, similar to an ERC-20 token's name
  string public name;

  /// @notice Trigger symbol, similar to an ERC-20 token's symbol
  string public symbol;

  /// @notice Trigger description
  string public description;

  /// @notice Array of IDs of protocol platforms covered by this trigger
  uint256[] public platformIds;

  /// @notice Returns the address of the recipient who receives subsidies for creating a protection market using this trigger
  address public immutable recipient;

  /// @notice Returns true if the trigger condition has been met
  bool public isTriggered;

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
   * @notice Returns an array of IDs, where each ID corresponds to a protocol platform covered by this trigger
   * @dev See documentation for mapping of ID numbers to protocol platforms
   */
  function getPlatformIds() external view returns (uint256[] memory) {
    return platformIds;
  }

  /**
   * @dev Executes trigger-specific logic to check if a protection market has been triggered
   * @return True if the trigger condition occurred, false otherwise
   */
  function checkTriggerCondition() internal virtual returns (bool);

  /**
   * @notice Checks the trigger condition, sets isTriggered flag to true if condition is met, and returns the trigger status
   * @return True if trigger condition occurred, false otherwise
   */
  function checkAndToggleTrigger() external returns (bool) {
    // Returns true if the trigger condition has already been toggled
    if (isTriggered) return true;

    // Returns false if the trigger condition has not been toggled
    if (!checkTriggerCondition()) return false;

    // Returns true if the trigger condition has been toggled
    emit TriggerActivated();
    isTriggered = true;
    return isTriggered;
  }
}
