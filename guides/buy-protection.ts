import hre from 'hardhat';
import '@nomiclabs/hardhat-ethers';
import { Contract, ContractFactory } from 'ethers';
import { getChainId, getContractAddress, logSuccess, logFailure, supplyTokensTo, findLog } from '../utils/utils';
import comptrollerAbi from '../abi/Comptroller.json';
import cozyTokenAbi from '../abi/CozyToken.json';
import erc20Abi from '../abi/ERC20.json';

async function main(): Promise<void> {
  // STEP 0: ENVIRONMENT SETUP
  const supplyAmount = '1000'; // Amount of USDC we want to supply, in dollars (e.g. 1000 = $1000 = 1000 USDC)
  const borrowAmount = '200'; // Amount DAI we want to borrow, in dollars (e.g. 200 = $200 = 200 DAI)

  const provider = hre.ethers.provider;
  const signer = new hre.ethers.Wallet(process.env.PRIVATE_KEY as string, hre.ethers.provider);
  const chainId = getChainId(hre);
  const { AddressZero, MaxUint256 } = hre.ethers.constants;
  const { getAddress, parseUnits } = hre.ethers.utils;

  // Since we are testing on a forked Rinkeby and our account has no tokens, we need to initialize the account with
  // the required tokens
  await supplyTokensTo('USDC', supplyAmount, signer.address, hre, signer);

  // STEP 1: SUPPLY COLLATERAL
  // We know we'll need the Comptroller, so create an instance the Comptroller contract
  const comptrollerAddress = getContractAddress('comptroller', chainId);
  const comptroller = new Contract(comptrollerAddress, comptrollerAbi, signer); // connect signer for sending transactions

  // Let's say we have 1000 USDC to use as collateral
  // The first check is to make sure a USDC Money Market exists that we can supply to. We know that Money Markets
  // have a trigger address of the zero address, so we use that to query the Comptroller fo the Money Market address
  const usdcAddress = getContractAddress('USDC', chainId); // use our helper method to get the USDC contract address
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
  // Your account is now ready to borrow funds. Let's say we want protection for Compound's cDAI and we know the
  // Rinkeby protection market for cDAI is deployed at 0xF5400eb85bDb682d9c4FD9331d3cF34E423e8e1A.

  // We want to borrow protected DAI so we can deposit it straight into Compound, so first let's verify the
  // underlying token we'd borrow is in fact DAI
  const daiAddress = getContractAddress('DAI', chainId); // use our helper method to get the DAI contract address
  const compProtectionMarket = new Contract('0xF5400eb85bDb682d9c4FD9331d3cF34E423e8e1A', cozyTokenAbi, signer);
  const underlying = await compProtectionMarket.underlying();
  if (getAddress(daiAddress) !== getAddress(underlying)) {
    // We use getAddress() to ensure both addresses are checksummed before comparing them. If this block executes,
    // the underlying of the protection market is not the underlying we want, so we exit the script
    logFailure('DAI addresses do not match. Exiting script');
    return;
  }

  // Now we do the borrow
  const dai = new Contract(daiAddress, erc20Abi, signer);
  const parsedBorrowAmount = parseUnits(borrowAmount, await dai.decimals()); // scale amount based on number of decimals
  const borrowTx = await compProtectionMarket.borrow(parsedBorrowAmount);
  const { log: borrowLog, receipt: borrowReceipt } = await findLog(borrowTx, compProtectionMarket, 'Borrow', provider);
  logSuccess(`Protected DAI borrowed in transaction ${borrowReceipt.transactionHash}`);

  // Done! You are now supplying 1000 USDC as collateral to borrow 200 protected DAI. The DAI debt will not need
  // to be paid back if the Compound trigger event occurs, so the 200 DAI can now be safely supplied to Compound
}

// We recommend this pattern to be able to use async/await everywhere and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error(error);
    process.exit(1);
  });
