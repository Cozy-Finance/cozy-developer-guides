import ethers from 'ethers';
import chalk from 'chalk';
import rinkebyAddresses from '../deployments/rinkeby.json';
import { HardhatRuntimeEnvironment } from 'hardhat/types';

// Mapping of chainId to contract addresses
const address = { 4: rinkebyAddresses };
type ChainId = keyof typeof address;
type ContractNames = keyof typeof rinkebyAddresses;

// Logging helper methods
//   - \u2713 = check symbol
//   - \u2717 = x symbol
export const logSuccess = (msg: string) => console.log(`${chalk.green('\u2713')} ${msg}`);
export const logFailure = (msg: string) => console.log(`${chalk.red('\u2717')} ${msg}`);

// Gets a contract's address by it's name and chainId
export const getContractAddress = (name: string, chainId: number) => {
  return address[chainId as ChainId][name as ContractNames];
};

// Gets the chainId from the hardhat configuration (normally you could get this from ethers.provider.network.chainId)
export const getChainId = (hre: HardhatRuntimeEnvironment) => {
  const defaultChainId = 4; // default to Rinkeby
  const forkUrl = hre.config.networks.hardhat.forking?.url;
  if (!forkUrl) return defaultChainId;
  if (forkUrl.includes('mainnet')) return 1;
  if (forkUrl.includes('ropsten')) return 3;
  if (forkUrl.includes('rinkeby')) return 4;
  if (forkUrl.includes('goerli')) return 5;
  if (forkUrl.includes('kovan')) return 42;
  return defaultChainId;
};

// When operating on a forked network, our account needs to get tokens somehow. When forking mainnet, we can either use
// private key corresponding to an account that already has the needed tokens, or we can use Hardhat's
// `hardhat_impersonateAccount` RPC method to transfer ourselves tokens from any account that has them. On Rinkeby,
// anyone can mint the required tokens, so we simply mint them
export const supplyTokensTo = async (
  symbol: string,
  amount: string,
  to: string,
  hre: HardhatRuntimeEnvironment,
  signer: ethers.Wallet
) => {
  // symbol is our token symbol, and amount is the human-readable amount. Currently this method only supports Rinkeby
  const chainId = getChainId(hre);
  if (chainId !== 4) throw new Error('supplyTokensTo: Unsupported network');
  const tokenAddress = getContractAddress(symbol, chainId);
  const mintAbi = ['function mint(address,uint256) returns (bool)', 'function decimals() view returns (uint8)'];
  const token = new hre.ethers.Contract(tokenAddress, mintAbi, signer);
  const decimals = await token.decimals();
  await token.mint(to, hre.ethers.utils.parseUnits(amount, decimals));
};

/**
 * @notice: Returns true if event named `logName` was emitted by `contract`
 * in the provided `tx
 * @param tx: ethers contract call response, of type ContractTransaction
 * @param contract: Instance of an ethers Contract
 * @param logName: Name of the log to look for
 * @param provider: Provider to use
 * @returns receipt if Log was found, throws and prints error codes if not
 */
export const findLog = async (
  tx: ethers.providers.TransactionResponse,
  contract: ethers.Contract,
  logName: string,
  provider: ethers.providers.JsonRpcProvider
) => {
  // Wait for the transaction to be mined, then get the transaction receipt
  await tx.wait();
  const receipt = await provider.getTransactionReceipt(tx.hash);

  // Use our custom parseLog method to parse logs, that way it does not throw on failure
  const logs = receipt.logs.map(parseLog(contract));

  // For each log in logs, find the first one with a name equal to our target `logName`
  const log = logs.filter((log) => log?.name === logName)[0];

  // Found, return the parsed log information and the receipt
  if (log) return { log, receipt };

  // If not found, let's search for Failure logs. If we find one, log the error codes and throw since we should
  // assume it's unsafe to continue execution
  const failureLog = logs.filter((log) => log?.name === 'Failure')[0];
  if (!failureLog) throw new Error(`Expected log name and Failure logs both not found in transaction ${tx.hash}`);
  logFailure(`Error codes: ${failureLog?.args}`);
  throw new Error('Transaction failed. See error codes above and check them against ErrorReporter.sol');
};

/**
 * @notice Wrapper around ethers' parseLog that returns undefined instead of
 * throwing an error (an error is throw if we try parsing a log with the wrong
 * interface)
 * @param contract: Instance of an ethers Contract
 * @param log: A single `Log` from the tx receipt's logs array
 * @returns The parsed log, or undefined if it could not be parsed
 */
const parseLog = (contract: ethers.Contract) => (log: { topics: Array<string>; data: string }) => {
  try {
    return contract.interface.parseLog(log);
  } catch (err) {
    return undefined;
  }
};
