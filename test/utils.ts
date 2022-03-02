import { resolve } from 'path';
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: resolve(__dirname, './.env') });

import { ethers, network } from 'hardhat';
import { expect } from 'chai';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { BigNumber, BigNumberish, Contract } from 'ethers';
import dsProxyRegistryAbi from '../abi/DSProxyRegistry.json';
import dsProxyAbi from '../abi/DSProxy.json';
import erc20Abi from '../abi/ERC20.json';
import hardhatConfig from '../hardhat.config';

const { defaultAbiCoder, hexStripZeros, hexZeroPad, keccak256 } = ethers.utils;

// --- Constants ---
export const WAD = 10n ** 18n;
export const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE';
export const WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const maxUint256 = 2n ** 256n - 1n;

export const markets = {
  comptroller: '0x895879B2c1Fbb6CCFcD101f2D3F3c76363664f92',
  cozyEth: '0xF8ec0F87036565d6B2B19780A54996c3B03e91Ea',
  cozyDai: '0xe6EF65EC40D943c3f675165B0b17e06862Fe3d82',
  cozyUsdc: '0xdBDF2fC3Af896e18f2A9DC58883d12484202b57E',
  cozyWbtc: '0xf146c26136C1F80c9f0967d27BCb7E500D45681f',
};

// Mapping from lowercase token symbol to properties about that token
export const tokens = {
  eth: { address: ETH_ADDRESS, name: 'Ether', symbol: 'ETH', decimals: 18, mappingSlot: null },
  weth: { address: WETH_ADDRESS, name: 'Wrapped Ether', symbol: 'WETH', decimals: 18, mappingSlot: '0x3' },
  dai: { address: '0x6B175474E89094C44Da98b954EedeAC495271d0F', name: "Dai", symbol: "DAI", decimals: 18, mappingSlot: '0x2' }, // prettier-ignore
  usdc: { address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', name: "USD Coin", symbol: "USDC", decimals: 6, mappingSlot: '0x9' }, // prettier-ignore
  wbtc: { address: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', name: "Wrapped BTC", symbol: "WBTC", decimals: 8, mappingSlot: '0x0' }, // prettier-ignore
};

export type SupportedToken = keyof typeof tokens;

// --- Token helpers ---
// Gets token balance
export async function balanceOf(token: SupportedToken | string, address: string): Promise<BigNumber> {
  if (token === 'eth') return ethers.provider.getBalance(address);
  const tokenAddress = token.length === 42 ? token : tokens[token as SupportedToken].address;
  const abi = ['function balanceOf(address) external view returns (uint256)'];
  const contract = new ethers.Contract(tokenAddress, abi, ethers.provider);
  return contract.balanceOf(address);
}

// Arbitrarily set token balance of an account to a given amount
export async function setBalance(tokenSymbol: SupportedToken, to: string, amount: BigNumberish): Promise<void> {
  // If ETH, set the balance directly
  if (tokenSymbol === 'eth') {
    await network.provider.send('hardhat_setBalance', [to, hexStripZeros(BigNumber.from(amount).toHexString())]);
    return;
  }

  // Otherwise, compute the storage slot containing this users balance and use it to set the balance
  const slot = getSolidityStorageSlot(tokens[tokenSymbol].mappingSlot, to);
  await network.provider.send('hardhat_setStorageAt', [tokens[tokenSymbol].address, slot, to32ByteHex(amount)]);
}

// Verify transaction has no Failure logs from Cozy
export async function expectSuccess(txHash: string) {
  const failureTopic = '0x45b96fe442630264581b197e84bbada861235052c5a1aadfff9ea4e40a969aa0';
  const { logs } = await ethers.provider.getTransactionReceipt(txHash);
  expect(logs.filter((log: { topics: string[] }) => log.topics[0] === failureTopic)).to.have.lengthOf(0);
}

// Gives the specified account collateral in Cozy so they can borrow from a protection market
export async function mint(account: SignerWithAddress) {
  // Fund account with 1000 ETH to execute the transactions, and save of formatted initial balance (per RPC spec: https://ethereum.org/en/developers/docs/apis/json-rpc/#hex-value-encoding)
  const initEthBalanceBn = await ethers.provider.getBalance(account.address);
  const initEthBalanceString = initEthBalanceBn.eq('0') ? '0x0' : hexStripZeros(initEthBalanceBn.toHexString());
  await network.provider.send('hardhat_setBalance', [account.address, '0x3635c9adc5dea00000']);

  // Supply collateral
  const cozyEth = new Contract(markets.cozyEth, ['function mint() external payable'], account);
  await cozyEth.mint({ value: 100n * WAD }); // supply 100 ETH

  // Enter markets
  const abi = ['function enterMarkets(address[] calldata cTokens) external returns (uint256[] memory)'];
  const comptroller = new Contract(markets.comptroller, abi, account);
  await comptroller.enterMarkets([markets.cozyEth]);

  // Reset account balance to original value
  await network.provider.send('hardhat_setBalance', [account.address, initEthBalanceString]);
}

// Supplies funds to a protection market so they can be borrowed and sets borrow cap to 0 (i.e. no borrow cap)
export async function prepareProtectionMarket({
  account,
  market,
  token,
  mintAmount,
}: {
  account: SignerWithAddress;
  market: string;
  token: SupportedToken;
  mintAmount: BigNumberish;
}) {
  // ETH protection markets have a different mint() signature
  if (token === 'eth') {
    const cozyPm = new Contract(market, ['function mint() external payable'], account);
    await cozyPm.mint({ value: mintAmount }); // supply mintAmount ETH
  } else {
    await setBalance(token, account.address, BigNumber.from(mintAmount).mul(10)); // set balance to 10x mint amount
    const tokenContract = new Contract(tokens[token].address, erc20Abi, account);
    await tokenContract.approve(market, maxUint256);

    const cozyPm = new Contract(market, ['function mint(uint256 mintAmount) external returns (uint256)'], account);
    await cozyPm.mint(mintAmount); // supply mintAmount
  }

  // Impersonate admin to set borrow cap to zero
  const abi = [
    'function admin() external view returns (address)',
    'function _setMarketBorrowCaps(address[] cTokens, uint256[] newBorrowCaps)',
  ];
  const comptroller = new Contract(markets.comptroller, abi, account);
  const admin = await comptroller.admin(); // get admin address
  await network.provider.request({ method: 'hardhat_impersonateAccount', params: [admin] }); // impersonate account
  await network.provider.send('hardhat_setBalance', [admin, '0x56bc75e2d63100000']); // give admin 100 ETH
  await comptroller.connect(await ethers.getSigner(admin))._setMarketBorrowCaps([market], [0]); // remove borrow cap
  await network.provider.request({ method: 'hardhat_stopImpersonatingAccount', params: [admin] });
}

// --- Storage slot helper methods ---
// Returns the storage slot for a Solidity mapping from an `address` to a value, given the slot of the mapping itself,
//  `mappingSlot`. Read more at https://docs.soliditylang.org/en/latest/internals/layout_in_storage.html#mappings-and-dynamic-arrays
export function getSolidityStorageSlot(mappingSlot: string, address: string) {
  return hexStripZeros(keccak256(defaultAbiCoder.encode(['address', 'uint256'], [address, mappingSlot])));
}

// --- Generic helpers ---
// Build proxy wallet for user
export async function buildProxy(account: SignerWithAddress) {
  const proxyRegistryAddress = '0x4678f0a6958e4D2Bc4F1BAF7Bc52E8F3564f3fE4';
  const proxyRegistry = new Contract(proxyRegistryAddress, dsProxyRegistryAbi, account);
  await proxyRegistry['build()']();
  const proxyAddress = await proxyRegistry.proxies(account.address); // get address of new proxy
  const proxy = await ethers.getContractAt(dsProxyAbi, proxyAddress, account); // get instance of new proxy
  return proxy;
}

// Converts a number to a 32 byte hex string
export function to32ByteHex(x: BigNumberish) {
  return hexZeroPad(BigNumber.from(x).toHexString(), 32);
}

// Reset state between tests
export async function reset() {
  await network.provider.request({
    method: 'hardhat_reset',
    params: [
      {
        forking: {
          jsonRpcUrl: hardhatConfig.networks?.hardhat?.forking?.url,
          blockNumber: hardhatConfig.networks?.hardhat?.forking?.blockNumber, // requires archive node data
        },
      },
    ],
  });
}
