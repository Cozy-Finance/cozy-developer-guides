/**
 * This guide covers the following:
 *   - Creating a trigger contract
 *   - Deploying a new Protection Market using that trigger contract
 */

import hre from 'hardhat';
import '@nomiclabs/hardhat-ethers';
import { Contract, ContractFactory } from 'ethers';
import { getChainId, getContractAddress, logSuccess, logFailure, findLog } from '../utils/utils';
import comptrollerAbi from '../abi/Comptroller.json';

// STEP 0: ENVIRONMENT SETUP
const provider = hre.ethers.provider;
const signer = new hre.ethers.Wallet(process.env.PRIVATE_KEY as string, hre.ethers.provider);
const chainId = getChainId(hre);
const { AddressZero } = hre.ethers.constants;

// STEP 1: TRIGGER CONTRACT SETUP
// Define required constructor parameters
const name = 'Mock Trigger'; // trigger name
const symbol = 'MOCK'; // trigger symbol
const description = 'A mock trigger that anyone can toggle'; // trigger description
const platformIds = [3]; // array of platform IDs that this trigger protects
const recipient = '0x1234567890AbcdEF1234567890aBcdef12345678'; // address of subsidy recipient

// STEP 2: TRIGGER CONTRACT DEVELOPMENT
// For this step, see the TriggerInterface and MockTrigger contracts and read the corresponding markdown file

// STEP 3: PROTECTION MARKET DEPLOYMENT
async function main(): Promise<void> {
  // Compile contracts to make sure we're using the latest version of the trigger contracts
  await hre.run('compile');

  // Get instance of the Trigger ContractFactory with our signer attached
  const MockTriggerFactory: ContractFactory = await hre.ethers.getContractFactory('MockTrigger', signer);

  // Deploy the trigger contract
  const trigger: Contract = await MockTriggerFactory.deploy(name, symbol, description, platformIds, recipient);
  await trigger.deployed();
  logSuccess(`MockTrigger deployed to ${trigger.address}`);

  // Let's choose DAI as the underlying, so first we need to check if there's a DAI Money Market.
  // We know that Money Markets have a trigger address of the zero address, so we use that to query the Comptroller
  // for the Money Market address
  const daiAddress = getContractAddress('DAI', chainId);
  const comptrollerAddress = getContractAddress('Comptroller', chainId);
  const comptroller = new Contract(comptrollerAddress, comptrollerAbi, signer); // connect signer for sending transactions
  const cozyDaiAddress = await comptroller.getCToken(daiAddress, AddressZero);

  // If the returned address is the zero address, a money market does not exist and we cannot deploy a protection
  // market with DAI as the underlying
  if (cozyDaiAddress === AddressZero) {
    logFailure('No DAI Money Market exists. Exiting script');
    return;
  }
  logSuccess(`Safe to continue: Found DAI Money Market at ${cozyDaiAddress}`);

  // If we're here, a DAI Money Market exists, so it's safe to create our new Protection Market. If we tried
  // to create a new Protection Market before a DAI Money Market existed, our transaction would revert
  const tx = await comptroller.deployProtectionMarket(daiAddress, trigger.address);

  // This should emit a ProtectionMarketListed event on success, so let's check for that event. If not found, this
  // method will throw and print the Failure error codes which can be looked up in ErrorReporter.sol
  const { log, receipt } = await findLog(tx, comptroller, 'ProtectionMarketListed', provider);
  logSuccess(`Success! Protection Market deployed to ${log?.args.cToken} in transaction ${receipt.transactionHash}`);

  // Done! You have successfully deployed your protection market
}

// We recommend this pattern to be able to use async/await everywhere and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error(error);
    process.exit(1);
  });
