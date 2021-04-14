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
  const compProtectionMarket = new Contract('0xA6Ef3A6EfEe0221f30A43cfaa36142F6Bc050c4d', cozyTokenAbi, signer);
  const borrowTx = await compProtectionMarket.borrow(parsedBorrowAmount); // borrow DAI
  await findLog(borrowTx, compProtectionMarket, 'Borrow', provider); // verify things worked successfully
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
  }
}

// We recommend this pattern to be able to use async/await everywhere and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error(error);
    process.exit(1);
  });
