import hre from 'hardhat';
import '@nomiclabs/hardhat-ethers';

import { Contract, ContractFactory } from 'ethers';

async function main(): Promise<void> {
  await hre.run('compile');

  // Define constructor parameters
  const name = 'Mock Trigger'; // trigger name
  const symbol = 'MOCK'; // trigger symbol
  const description = 'A mock trigger that anyone can toggle'; // trigger description
  const platformIds = [3]; // array of platform IDs that this trigger protects
  const recipient = '0x60A5dcB2fC804874883b797f37CbF1b0582ac2dD'; // address of subsidy recipient

  // We get the contract to deploy, deploy it, and print the address
  const MockTrigger: ContractFactory = await hre.ethers.getContractFactory('MockTrigger');
  const multicall: Contract = await MockTrigger.deploy(name, symbol, description, platformIds, recipient);
  await multicall.deployed();

  console.log('MockTrigger deployed to: ', multicall.address);

  // TODO more stuff
}

// We recommend this pattern to be able to use async/await everywhere and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error(error);
    process.exit(1);
  });
