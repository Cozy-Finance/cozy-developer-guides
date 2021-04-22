# Cozy Developer Guides

This repository contains various guides to show you how to interact with the Cozy Protocol. These guides assume knowledge of [TypeScript](https://www.typescriptlang.org/), [ethers.js](https://docs.ethers.io/v5/single-page/), and [Solidity](https://docs.soliditylang.org/en/v0.8.3/), as well as familiarity with the Cozy Protocol. [Hardhat](https://hardhat.org/) is used as well, but you shouldn't need to be too familiar with Hardhat to use this repo.

## Getting Started

All scripts in this repository are run against a forked Rinkeby, so you can have confidence that if your scripts work in this environment they should also work in production.

First, run `yarn` at the project root to install all dependencies.

Next, copy the `.env.example` file, rename it to `.env`, and set the variables accordingly. The `RPC_URL` shows an Infura endpoint as the default, but you are free to use any node provider of your choice. The private key will be used to generate the primary account used in scripts, so you can either use a dummy private key and use the power of a forked network to fund it, or you can use a private key corresponding to an account that's already funded.

## Usage

All guides are located in the `guides` folder and contain up to two files:

1. An executable TypeScript file
2. A markdown file with additional information and details

A script may be run with the command `yarn ts-node guides/<script-name.ts>`. Additional notes on the guides:

- Some guides may only have one of the two files. Guides with both can be recognized as the `*.md` and `*.ts` files will have the same name. All TypeScript files will be heavily commented to aid understanding and readability, and TypeScript is used throughout so there's no ambiguity around what a variable or parameter is.
- Some guides require contracts. Any required contracts live in the `contracts` folder, and you can compile the contracts in that folder with `yarn build`.

And finally, a few notes on Hardhat:

- The scripts explicitly require the Hardhat Runtime Environment with `import hre from 'hardhat'`. This is optional, but is required for running the script in a standalone fashion with `yarn ts-node <script.ts>`. When running the script with `yarn hardhat run <script>` this explicit import is unnecessary. We default to the explicit, `ts-node` approach so there's less hardhat magic and improved readability and portability. Similarly, this is why some scripts call `await hre.run('compile')`&mdash;this compiles our contracts, and would otherwise be done automatically when running with `yarn hardhat run <script>`
- Some scripts deploy contracts by using `hre.ethers.getContractFactory()` to get the Contract Factory instance. If you want to do this without Hardhat, use the regular ethers [Contract Factory](https://docs.ethers.io/v5/single-page/#/v5/api/contract/contract-factory/) approach. Deploying contracts is not the focus of these guides, so it uses the Hardhat approach for convenience and brevity.
