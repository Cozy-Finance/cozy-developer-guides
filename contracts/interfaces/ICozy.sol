pragma solidity ^0.8.9;

/**
 * @dev Interfaces for Cozy contracts
 */

interface ICozyShared {
  function underlying() external view returns (address);

  function borrow(uint256 borrowAmount) external returns (uint256);

  function borrowBalanceCurrent(address account) external returns (uint256);
}

// @dev Interface for a Cozy market with an ERC20 token underlying
interface ICozyToken is ICozyShared {
  function repayBorrowBehalf(address borrower, uint256 repayAmount) external returns (uint256);

  function repayBorrow(uint256 repayAmount) external returns (uint256);
}

// @dev Interface for a Cozy market with ETH underlying
interface ICozyEther is ICozyShared {
  function repayBorrowBehalf(address borrower) external payable;
}

// @dev Interface for the Maximillion contract used to repay ETH borrows
interface IMaximillion {
  function repayBehalfExplicit(address borrower, ICozyEther market) external payable;
}
