/**
 * TODO description of script
 *
 *
 */

import hre from 'hardhat';
import '@nomiclabs/hardhat-ethers';
import { Contract, ContractFactory } from 'ethers';
import { getChainId, getContractAddress, logSuccess, logFailure, supplyTokensTo, findLog } from '../utils/utils';
import comptrollerAbi from '../abi/Comptroller.json';
import cozyTokenAbi from '../abi/CozyToken.json';
import cozyEtherAbi from '../abi/CozyEther.json';
import maximillionAbi from '../abi/Maximillion.json';
import erc20Abi from '../abi/ERC20.json';

async function main(): Promise<void> {
  // STEP 0: ENVIRONMENT SETUP
  // If the signer you are using does not have a balance of over 1 ETH, you'll need to transfer some ETH to it from
  // this script. Since this is run against a forked network, you can use `hardhat_impersonateAccount` to impersonate
  // any account with ETH and send it to your signer's address: https://hardhat.org/guides/mainnet-forking.html#impersonating-accounts
  const provider = hre.ethers.provider;
  const signer = new hre.ethers.Wallet(process.env.PRIVATE_KEY as string, hre.ethers.provider);
  const chainId = getChainId(hre);
  const cTokenDecimals = 8; // all Cozy Tokens have 8 decimals, so we define this for convenience later
  const ETH_ADDRESS = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'; // address used to represent ETH in the contracts
  const { AddressZero, MaxUint256, Zero } = hre.ethers.constants;
  const { formatUnits, getAddress, parseUnits } = hre.ethers.utils;

  // Here we follow a condensed version of the buy-protection.ts script so our account has positions to manage. See
  // the buy-protection.ts file more more information on what we are doing here.

  // Setup
  const supplyAmount = '1000'; // Amount of USDC we want to supply, in dollars (e.g. 1000 = $1000 = 1000 USDC)
  const borrowAmount = '200'; // Amount DAI we want to borrow, in dollars (e.g. 200 = $200 = 200 DAI)
  await supplyTokensTo('USDC', supplyAmount, signer.address, hre, signer); // Fund our test account with tokens

  // Get instance of Comptroller and use it to find address of the Cozy USDC Money Market
  const comptrollerAddress = getContractAddress('Comptroller', chainId); // get address of the Comptroller
  const comptroller = new Contract(comptrollerAddress, comptrollerAbi, signer); // connect signer for sending transactions
  const usdcAddress = getContractAddress('USDC', chainId); // use our helper method to get the USDC contract address
  const cozyUsdcAddress = await comptroller.getCToken(usdcAddress, AddressZero); // get address of USDC Money Market
  const cozyUsdc = new Contract(cozyUsdcAddress, cozyTokenAbi, signer); // create Cozy USDC contract instance
  const usdc = new Contract(usdcAddress, erc20Abi, signer); // create USDC contract instance

  // Mint cozyUSDC with our USDC
  const parsedSupplyAmount = parseUnits(supplyAmount, await usdc.decimals()); // scale amount based on number of decimals
  const approveTx = await usdc.approve(cozyUsdc.address, MaxUint256); // approve Cozy USDC to spend our USDC
  const mintTx1 = await cozyUsdc.mint(parsedSupplyAmount); // send the mint tx
  await findLog(mintTx1, cozyUsdc, 'Mint', provider); // verify things worked successfully

  // Mint cozyEth with our ETH
  const cozyEthAddress = await comptroller.getCToken(ETH_ADDRESS, AddressZero); // get address of USDC Money Market
  const cozyEth = new Contract(cozyEthAddress, cozyEtherAbi, signer); // create Cozy USDC contract instance
  const mintTx2 = await cozyEth.mint({ value: parseUnits('1', 18) }); // send the mint tx
  await findLog(mintTx2, cozyEth, 'Mint', provider); // verify things worked successfully

  // Enter markets and wait for all transactions to be mined
  const emTx = await comptroller.enterMarkets([cozyUsdc.address, cozyEth.address]); // after Mint we can enter markets
  await Promise.all([approveTx.wait(), mintTx1.wait(), mintTx2.wait(), emTx.wait()]); // wait for txs to be mined

  // Borrow protected DAI from known protection market at address 0xA6Ef3A6EfEe0221f30A43cfaa36142F6Bc050c4d
  const daiAddress = getContractAddress('DAI', chainId); // use our helper method to get the DAI contract address
  const dai = new Contract(daiAddress, erc20Abi, signer);
  const parsedBorrowAmount = parseUnits(borrowAmount, await dai.decimals()); // scale amount based on number of decimals
  const compoundDaiProtectionMarket = new Contract('0xA6Ef3A6EfEe0221f30A43cfaa36142F6Bc050c4d', cozyTokenAbi, signer);
  const borrowTx = await compoundDaiProtectionMarket.borrow(parsedBorrowAmount); // borrow DAI
  await findLog(borrowTx, compoundDaiProtectionMarket, 'Borrow', provider); // verify things worked successfully
  logSuccess('Supply and borrow setup completed');

  // STEP 1: VIEWING POSITIONS
  // To start, let's get an array of CToken addresses for each market we've entered. When you borrow from a market, you
  // are automatically entered into that market
  const ourAddress = signer.address; // shorthand, for convenience
  const assets = await comptroller.getAssetsIn(ourAddress); // returns an array of CozyToken addresses

  // Now we can do a few things, such as checking balances, borrow amounts, and looking up exchange rats. We don't yet
  // necessarily know whether we've borrowed from and/or supplied to this market, but we can easily figure that out.
  // Let's loop through each asset and learn our current status in that market.
  console.log('Checking status of each asset...\n');
  for (const asset of assets) {
    // First we'll check balances in this loop and see if any of our balances come from borrows. For brevity, we
    // prefix all properties about the underlying token with `u`
    const cToken = new Contract(asset, cozyTokenAbi, signer);
    const [name, symbol] = await Promise.all([cToken.name(), cToken.symbol()]);
    console.log(`Current asset has name "${name}" and symbol "${symbol}"`);

    // Let's also learn about the underlying token. First we determine if the underlying is ETH then get a contract
    // instance for the underlying token if the underlying is not ETH
    const uAddr = await cToken.underlying();
    const isEth = uAddr === ETH_ADDRESS; // true if underlying is ETH, false otherwise
    const underlying = isEth ? null : new Contract(uAddr, erc20Abi, signer);

    // Lastly we either read set the values if ETH is underlying, or read the values if it's a token
    const uName = underlying ? await underlying.name() : 'Ether';
    const uSymbol = underlying ? await cToken.symbol() : 'ETH';
    const uDecimals = underlying ? await underlying.decimals() : 18;
    console.log(`  Underlying ${uName} (${uSymbol}) has ${uDecimals} decimals`);

    // Get our balance of the cToken
    const balance = await cToken.balanceOf(ourAddress);
    const balanceScaled = formatUnits(balance, cTokenDecimals);
    if (balance.eq(Zero)) {
      // Balance is zero, so we have not supplied the underlying token
      console.log('  No Cozy Token balance, so nothing supplied');
    } else {
      // Balance is > 0, so we have supplied some amount of underlying tokens. Get exchange rate to figure out how
      // much underlying we have. The exchange rate is a mantissa (18 decimal value), so the value returned is scaled
      // by 10 ** (18 + underlyingDecimals - cTokenDecimals)
      const exchangeRate = await cToken.exchangeRateStored();
      const scale = 18 + uDecimals - cTokenDecimals;
      const uBalance = balance.mul(exchangeRate);
      const uBalanceScaled = formatUnits(uBalance, scale + cTokenDecimals);
      console.log(`  Balance of ${balanceScaled} Cozy Tokens (equal to ${uBalanceScaled} underlying)`);
    }

    // Now get our balance of the underlying token
    const uBalance = underlying ? await underlying.balanceOf(ourAddress) : await signer.provider.getBalance(ourAddress);
    if (uBalance.eq(Zero)) {
      // Underlying balance is zero, so we have not borrowed the underlying token
      console.log(`  No underlying ${uSymbol} balance`);
    } else {
      // Underlying balance is above zero, BUT we still may not have borrowed this token -- we may have already had some
      const uBalanceScaled = formatUnits(uBalance, uDecimals);
      console.log(`  Balance of ${uBalanceScaled} underlying ${uSymbol} tokens`);

      // Read the amount borrowed
      const borrowBalance = await cToken.borrowBalanceStored(ourAddress);
      const borrowBalanceScaled = formatUnits(borrowBalance, uDecimals); // scale to human readable units

      // Now we determine if the funds were borrowed
      if (borrowBalance.eq(Zero)) console.log(`  None of the underlying ${uSymbol} tokens we have were borrowed`);
      else if (borrowBalance.eq(uBalance)) console.log(`  All the underlying ${uSymbol} tokens we have were borrowed`);
      else console.log(`  ${borrowBalanceScaled} of the ${uBalanceScaled} underlying ${uSymbol} tokens were borrowed`);
    }
    console.log('\n');
  } // end for each asset

  // STEP 2: CHECKING ACCOUNT LIQUIDITY
  // The amount of collateral you have is computed by multiplying the supplied balance in a market by that market's
  // collateral factor, and summing that across all markets. Total borrow balances are subtracted from that,
  // resulting in an Account Liquidity value. Quoting from the Compound documentation:
  //   > Account Liquidity represents the USD value borrowable by a user, before it reaches liquidation. Users with
  //   > a shortfall (negative liquidity) are subject to liquidation, and can’t withdraw or borrow assets until
  //   > Account Liquidity is positive again.
  // To avoid liquidation, you must ensure that Account Liquidity is always greater than zero. We can check this
  // for any user as shown below, where we check our own liquidity

  // getAccountLiquidity returns three values. The first is an error code, the second is the excess liquidity, and
  // the third is the shortfall. Only one of the last two will ever be positive
  const [errorCode, liquidity, shortfall] = await comptroller.getAccountLiquidity(signer.address);

  // Make sure there were no errors reading the data
  if (errorCode.toString() !== '0') {
    logFailure(`Could not read liquidity. Received error code ${errorCode}. Exiting script`);
    return;
  }

  // There were no errors, so now we check if we have an excess or a shortfall
  if (shortfall.gt(Zero)) {
    logFailure(`WARNING: Account is undercollateralized and may get liquidated! Shortfall amount: ${shortfall}`);
  } else if (liquidity.gt(Zero)) {
    logSuccess(`Account has excess liquidity and is safe. Amount of liquidity: ${liquidity}`);
  } else {
    logFailure('WARNING: Account has no liquidity and no shortfall');
  }

  // STEP 3: MANAGING POSITIONS
  // If your collateralization ratio is too close to the minimum required, i.e. you have a shortfall or a small
  // amount of excess liquidity in the previous step, you may want to supply more collateral. To supply more
  // collateral programmatically, follow the detailed steps in buy-protection.ts (or reference the abbreviated,
  // less, detailed version above in this script)

  // An alternate way to reduce your chance of liquidation is to pay back some or all of your borrowed debt.
  // Let's go through a few ways to do this

  // If we want to repay our own borrows, we can use the repayBorrow method. First we approve the contract to spend
  // our DAI, then we execute the repay
  const daiApproveTx = await dai.approve(compoundDaiProtectionMarket.address, MaxUint256); // send approval transaction
  await daiApproveTx.wait(); // wait for approval transaction to be mined
  const repayAmount = parseUnits('25', 18); // we'll repay 25 DAI
  const repayTx = await compoundDaiProtectionMarket.repayBorrow(repayAmount); // repay some DAI
  await findLog(repayTx, compoundDaiProtectionMarket, 'RepayBorrow', provider); // verify things worked successfully
  logSuccess('Successfully repaid a portion of the borrow');

  // Some notes on the above repayBorrow() method:
  //   1. If we wanted to repay the full amount, the best way to do this is to set the repayAmount to MaxUint256. The
  //      Cozy contracts recognize this as a magic number that will repay all your token debt. If you want to repay
  //      all token debt and DO NOT use MaxUint256 as the amount, you'll be left with a very tiny borrow balance, known
  //      as dust. This is because interest accrues during the repay transaction, and it's extremely difficult to
  //      predict how much will accrue and send the exact right amount of tokens. Using MaxUint256 tells the contracts
  //      to repay the full debt after interest accrues
  //
  //   2. You could use repayBorrowBehalf(borrower,repayAmount) to repay `repayAmount` on behalf of `borrower`. In
  //      the example above, we could have equivalently used `repayBorrowBehalf(signer.address, repayAmount)` to
  //      repay our own debt.
  //
  //   3. If we wanted to pay back our full ETH balance, we'd have a similar dust issue since ETH is also used for
  //      gas and predicting the exact gas usage + interest accrual is not feasible. Instead, we can repay a full
  //      ETH balance using a special contract called the Maximillion contract. It lets you send extra ETH along with
  //      your transaction, and will refund you the excess after paying back all debt. Below is a sample usage

  // Repay all ETH debt with the Maximillion contract (we actually have zero ETH debt in the script, but that's ok).
  // First we get an instance of the Maximillion contract
  const maximillionAddress = getContractAddress('Maximillion', chainId);
  const maximillion = new Contract(maximillionAddress, maximillionAbi, signer);
  const ethMarketAddress = '0x212531FA38401345422262Ff05F968Df87031FCE'; // address of the Cozy ETH Money Market

  // Now we do the repay. Our debt is zero, so we send some excess ETH to be refunded after repaying the debt.
  // Notice how we specify that we are repaying debt for ourselves, `signer.address`, and we specify the address of
  // the market to repay debt in, `ethMarketAddress`. (We don't look for the success logs since this is a dummy
  // transaction).
  const value = parseUnits('0.1', 18);
  const repayEthTx = await maximillion.repayBehalfExplicit(signer.address, ethMarketAddress, { value });
}

// We recommend this pattern to be able to use async/await everywhere and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error(error);
    process.exit(1);
  });
