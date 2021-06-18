/**
 * This guide covers the following:
 *   - Supplying funds to a market
 *   - Entering markets to use supplied funds as collateral
 *   - Using that collateral to borrow funds
 */

import hre from 'hardhat';
import '@nomiclabs/hardhat-ethers';
import { Contract } from 'ethers';
import { getChainId, getContractAddress, logSuccess, logFailure, fundAccount, findLog } from '../utils/utils';
import comptrollerAbi from '../abi/Comptroller.json';
import cozyTokenAbi from '../abi/CozyToken.json';
import erc20Abi from '../abi/ERC20.json';

async function main(): Promise<void> {
  // STEP 0: ENVIRONMENT SETUP
  const supplyAmount = '1000'; // Amount of USDC we want to supply, in dollars (e.g. 1000 = $1000 = 1000 USDC)
  const borrowAmount = '200'; // Amount USDC we want to borrow for protected borrows, in dollars

  const provider = hre.ethers.provider;
  const signer = new hre.ethers.Wallet(process.env.PRIVATE_KEY as string, hre.ethers.provider);
  const chainId = getChainId(hre);
  const { AddressZero, MaxUint256 } = hre.ethers.constants;
  const { getAddress, parseUnits } = hre.ethers.utils;

  // Since we are testing on a forked mainnet and our account has no tokens (just ETH), we need to initialize the
  // account with the required tokens. This step is not needed when testing against a live network
  const usdcAddress = getContractAddress('USDC', chainId); // use our helper method to get the USDC contract address
  await fundAccount(usdcAddress, supplyAmount, signer.address, hre);

  // STEP 1: SUPPLY COLLATERAL
  // We know we'll need the Comptroller, so create an instance the Comptroller contract
  const comptrollerAddress = getContractAddress('Comptroller', chainId);
  const comptroller = new Contract(comptrollerAddress, comptrollerAbi, signer); // connect signer for sending transactions

  // Let's say we have 1000 USDC to use as collateral
  // The first check is to make sure a USDC Money Market exists that we can supply to. We know that Money Markets
  // have a trigger address of the zero address, so we use that to query the Comptroller fo the Money Market address
  const cozyUsdcAddress = await comptroller.getCToken(usdcAddress, AddressZero);

  // If the returned address is the zero address, a money market does not exist and we cannot supply USDC
  if (cozyUsdcAddress === AddressZero) {
    logFailure('No USDC Money Market exists. Exiting script');
    return;
  }
  logSuccess(`Safe to continue: Found USDC Money Market at ${cozyUsdcAddress}`);

  // Create a contract instance of the USDC Money Market
  const cozyUsdc = new Contract(cozyUsdcAddress, cozyTokenAbi, signer);

  // We're now ready to supply the collateral to the market, but there's some preparation we need to do beforehand.
  // First, recall that USDC has 6 decimal places, so we need to take that into account. We'll do this programmatically
  // by querying the USDC contract for the number of decimals it has
  const usdc = new Contract(usdcAddress, erc20Abi, signer);
  const decimals = await usdc.decimals();
  const parsedSupplyAmount = parseUnits(supplyAmount, decimals); // scale amount based on number of decimals

  // Next we need to approve the cozyUsdc contract to spend our USDC. We trust the Cozy contract, so approve it to
  // spend the maximum possible amount to avoid future approvals and save gas. Also notice that we show an alternative
  // way of getting the cozyUsdc Money Market's address: we use cozyUsdc.address which is equivalent to cozyUsdcAddress
  const approveTx = await usdc.approve(cozyUsdc.address, MaxUint256);
  await approveTx.wait();

  // Let's verify this approve transaction was successful
  const allowance = await usdc.allowance(signer.address, cozyUsdc.address);
  if (!allowance.eq(MaxUint256)) {
    logFailure('CozyUSDC does not have sufficient allowance to spend our USDC. Exiting script');
    return;
  }
  logSuccess('Approval transaction successful. Ready to mint CozyUSDC with our USDC');

  // Ready to mint our CozyUSDC from USDC
  const mintTx = await cozyUsdc.mint(parsedSupplyAmount);
  const { log: mintLog, receipt: mintReceipt } = await findLog(mintTx, cozyUsdc, 'Mint', provider);
  logSuccess(`CozyUSDC successfully minted in transaction ${mintReceipt.transactionHash}`);

  // STEP 2: ENTER MARKETS
  // Supplying assets does not automatically mean we can use them as collateral. To do that, we need to explicitly
  // call enterMarkets on the Comptroller for each asset we want to use as collateral. For now, that's just USDC.
  // (We use `em` as shorthand for `enterMarkets` in our variable names)
  const markets = [cozyUsdc.address];
  const emTx = await comptroller.enterMarkets(markets);
  const { log: emLog, receipt: emReceipt } = await findLog(emTx, comptroller, 'MarketEntered', provider);
  logSuccess(`Markets entered successfully: USDC can now be used as collateral`);

  // STEP 3: BORROW FUNDS
  // Your account is now ready to borrow funds

  // We want to borrow protected USDC so we can deposit it straight into Yearn's yUSDC vault, so first let's verify the
  // underlying token we'd borrow is in fact USDC
  const yearnProtectionMarketAddress = getContractAddress('YearnProtectionMarket', chainId);
  const yearnProtectionMarket = new Contract(yearnProtectionMarketAddress, cozyTokenAbi, signer);
  const underlying = await yearnProtectionMarket.underlying();
  if (getAddress(usdcAddress) !== getAddress(underlying)) {
    // We use getAddress() to ensure both addresses are checksummed before comparing them. If this block executes,
    // the underlying of the protection market is not the underlying we want, so we exit the script
    logFailure('USDC addresses do not match. Exiting script');
    return;
  }

  // Now we do the borrow
  const parsedBorrowAmount = parseUnits(borrowAmount, await usdc.decimals()); // scale amount based on number of decimals
  const borrowTx = await yearnProtectionMarket.borrow(parsedBorrowAmount);
  const { log: borrowLog, receipt: borrowReceipt } = await findLog(borrowTx, yearnProtectionMarket, 'Borrow', provider);
  logSuccess(`Protected USDC borrowed in transaction ${borrowReceipt.transactionHash}`);

  // Done! You are now supplying 1000 USDC as collateral to borrow 200 protected USDC. The USDC debt will not need
  // to be paid back if the Yearn trigger event occurs, so the 200 USDC can now be safely supplied to Yearn
}

// We recommend this pattern to be able to use async/await everywhere and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error(error);
    process.exit(1);
  });
