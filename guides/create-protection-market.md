# Creating a Protection Market

This guide will walk through process of creating a Protection Market. It is intended for developers who are familiar with smart contract development on the EVM using Solidity.

## Background

**Trigger contracts can be written by any third party developer, and used to deploy Cozy Protection Markets**. This guide will walk through process of creating a Protection Market. It is intended for developers who are familiar with smart contract development on the EVM using Solidity.

As detailed in [TODO: link to other section of docs], Cozy has two types of markets

### Money Markets

Money Markets are standard lending markets. They enable lenders to deposit assets to earn interest, borrowers to take out loans against collateral deposits, and liquidators to claim collateral of borrowers who are under-collateralized. Money Markets in Cozy are deployed and curated by Governance. These are just like existing money markets in protocols as Compound, such as the cDAI market.

Cozy money markets are deployed as instances of `CErc20Immutable`.

### Protection Markets

Protection Markets are unique to the Cozy system. They enable the same lending, borrowing, and liquidating mechanics of Money Markets, but they're also tied to a Trigger contract. In the context of developing new protection markets, this means:

- Each protection market has an associated `trigger` contract address. (For money markets, `trigger` is the zero address).
- Borrowers in a protection market have their debt canceled if the trigger contract says that a trigger event occurred.
- Only governance can create new money markets, but anyone can deploy a new protection market using `Comptroller.deployProtectionMarket()`. The process to do this is explained in the next section.

### Trigger Contracts

Trigger contracts encapsulate some logic which defines a one way gate. When a Protection Market is "triggered," the lending and borrowing in that market is no longer possible. Instead, those who have borrowed against this market have their debts cancelled, while those who have supplied assets as lenders "take a haircut," and receive a proportional claim of the assets left in the pool.

Triggers should be designed to observe the public state of on-chain protocols, and identify conditions which indicate a protocol failure. This could be the violation of a key invariant, the draining of a reserve pool, or any number of other concrete conditions that can be verified by external contract code.

When a Trigger is "triggered," it cancels the debts of the borrowers in that market, meaning they can keep the assets they borrowed without paying back their debts. This effectively acts as a protection payout for borrowers (protection seekers) at the expense of lenders (protection providers). To read more about this financial mechanic, read [TODO: link to other section of docs]

## Why Create Protection Markets?

As the name suggests, the purpose of Protection Markets is to provide protection for users of on-chain protocols. This could include protection against smart contract failures, hacks, rug pulls, and many other modes of protocol failure. **The primary reason to create a new Protection Market is to offer users of other protocols a trust minimized, crypto-native hedging mechanism against the failure of said protocol**.

## Development Guide

### Step 1: Trigger Contract Setup

From the Cozy repo, copy the contents of `TriggerInterface.sol` into your own contract file (perhaps in the future there will be a developer library that can be installed with npm/yarn that contains this interface).

Create your trigger contract file and have it inherit from the `TriggerInterface`. By inheriting from `TriggerInterface`, the trigger contract will have a state variable called `isTriggered`. This is always initialized to `false`, indicating that the trigger event has not yet occurred. When it occurs, this should be toggled to `true`.

To begin writing your trigger contract, start by configuring some trigger metadata:

1. Give your trigger a `name` and `symbol`. These are analogous to the ERC-20 name and symbol properties
2. The `description` of the trigger is a string describing what the trigger does
3. See Appendix A below to find a mapping between platform names and their ID numbers. For each protocol that your trigger protects against, add that ID to the array returned by `getPlatformIds()`. For example, if this trigger covers just Yearn, and Yearn has an ID of 4, this method should return [4]
4. The trigger should define a `recipient`, which may be used in the future to distribute rewards to users who create protection markets from triggers they've written.

### Step 2: Trigger Contract Development

Now the actual trigger logic can be implemented. The `checkAndToggleTrigger()` method is the core method of a trigger contract. This is where the logic occurs to see if some trigger event occurred in the protocol(s) defined by `getPlatformIds()`.

> :warning: The `checkAndToggleTrigger()` method is crucial to ensuring your trigger behaves properly, so please read the below section carefully!

The `checkAndToggleTrigger()` method should behave as follows:

- If `isTriggered == true` it should short-circuit and return true
- Otherwise, it should execute any logic required to determine the trigger status. After executing the logic:
  - If the trigger event occurred, this method should set `isTriggered` to `true` and return `true` (or, equivalently, return `isTriggered`).
  - If the trigger event has not occurred, this method should leave `isTriggered` as `false` and return `false` (or, equivalently, return `isTriggered`).

The only way to update the value returned by `isTriggered` must be through the `checkAndToggleTrigger()` method. This is the method called by a protection market to determine the trigger's state.

Note that protection markets enforce that triggers are "one-way" toggles. Each protection market stores its own `isTriggered` variable—separate from the trigger's `isTriggered` variable—which is initialized to false and toggled only once, when `checkAndToggleTrigger()` returns true. Because it can only be toggled once, to avoid confusion, it's recommended that triggers themselves should also follow the same convention of only allowing "one-way" toggles.

### Step 3: Protection Market Deployment

Once your trigger contract is complete, you are ready to deploy a new protection market that uses that trigger.

First you'll need to choose the `underlying` ERC-20 token that will be used for your protection market. For example, if you are writing a trigger to protect Compound's cDAI, choosing DAI as the `underlying` would be the logical choice because a user can borrow protected DAI from the protection market and immediately use it to mint protected cDAI on Compound. You could instead choose USDC (or ETH, or any other token) as the underlying, but now a user borrowing protected USDC would first need to swap it for DAI before they can mint protected cDAI.

> :information_source: To use ETH as the underlying, use an underlying address of `0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE`

To deploy a protection market with a given `underlying`, a money market for that underlying must exist. Once an `underlying` token is chosen, make sure a Money Market for that token exists by calling `Comptroller.getCToken(underlying, address(0))`. If it returns the zero address, a money market for this token does not exist, and you'll need to wait for one to be deployed by governance before continuing. (If you don't wait, protection market deployment will fail and you'll waste gas).

If a money market exists, you can now deploy the final version of the trigger contract. The protection market can be created by calling `Comptroller.deployProtectionMarket(underlying, trigger)`, where `underlying` is the underlying token's address for this CToken market, and `trigger` is the address of your trigger contract.

And you are now done! A new protection market exists, and will be initialized with a collateral factor of zero and use the default interest rate model specified in `ProtectionMarketFactory`.

## Appendix A: Platform IDs

| Platform ID | Platform Name |
| ----------- | ------------- |
| 1           | Yearn         |
| 2           | Aave          |
| 3           | Curve         |
| 4           | Compound      |
| 5           | Uniswap       |
