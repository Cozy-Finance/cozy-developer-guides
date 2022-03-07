// --- Imports ---
import { artifacts, ethers, network, waffle } from 'hardhat';
import { expect } from 'chai';
import { BigNumber, Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { balanceOf, buildProxy, expectSuccess, mint, prepareProtectionMarket, WAD, reset } from './utils';
import { CozyInvestCurve3CryptoEth } from '../typechain';
import cozyTokenAbi from '../abi/CozyToken.json';

const { deployContract, loadFixture } = waffle;
const overrides = { maxFeePerGas: 0, maxPriorityFeePerGas: 0, gasLimit: 10000000 };
const ZERO = ethers.constants.Zero;

const pools = [
  {
    network: 'Mainnet',
    mintAmount: 1000n * WAD,
    borrowAmount: 40n * WAD,
    badMarket: '0xf146c26136C1F80c9f0967d27BCb7E500D45681f', // BTC market
    moneyMarket: '0xF8ec0F87036565d6B2B19780A54996c3B03e91Ea', // ETH market
    protectionMarket: '0xF8ec0F87036565d6B2B19780A54996c3B03e91Ea',
    depositZap: '0x3993d34e7e99Abf6B6f367309975d1360222D446', // Curve tricrypto2 deposit zap
    lpToken: '0xc4AD29ba4B3c580e6D59105FFf484999997675Ff', // crv3crypto
    maximillion: '0xf859A1AD94BcF445A406B892eF0d3082f4174088', // Maximillion contract for repaying ETH debts
    gauge: '0xDeFd8FdD20e0f34115C7018CCfb655796F6B2168', // Curve tricrypto2 liquidity gauge
  },
];

// --- Tests ---
pools.forEach((pool) => {
  describe(`Curve 3Crypto: ${pool.network}`, function () {
    let proxy: Contract;
    let user: SignerWithAddress;
    let cozyInvestContract: CozyInvestCurve3CryptoEth;
    async function setup() {
      await reset();

      const [deployer, user] = await ethers.getSigners();

      // Deploy invest contract
      const cozyInvestContractArtifact = await artifacts.readArtifactSync('CozyInvestCurve3CryptoEth');
      const cozyInvestContract = <CozyInvestCurve3CryptoEth>(
        await deployContract(deployer, cozyInvestContractArtifact, [
          pool.moneyMarket,
          pool.protectionMarket,
          pool.maximillion,
          pool.depositZap,
          pool.gauge,
        ])
      );

      // Deploy user a proxy wallet
      const proxy = await buildProxy(user);

      // Supply protection to market
      await prepareProtectionMarket({
        account: deployer,
        market: pool.protectionMarket,
        token: 'eth',
        mintAmount: pool.mintAmount,
      });

      // Impersonate proxy wallet so we can easily give user's proxy wallet collateral, then zero out its balance
      await network.provider.request({ method: 'hardhat_impersonateAccount', params: [proxy.address] });
      const proxySigner = await ethers.getSigner(proxy.address);
      await mint(proxySigner);
      await network.provider.send('hardhat_setBalance', [proxy.address, '0x0']);
      await network.provider.request({ method: 'hardhat_stopImpersonatingAccount', params: [proxy.address] });
      // Only return variables used outside of the setup method
      return { proxy, user, cozyInvestContract };
    }

    describe('invest', () => {
      beforeEach(async () => {
        ({ proxy, user, cozyInvestContract } = await loadFixture(setup));
      });

      it('reverts if borrow fails', async () => {
        await expect(cozyInvestContract.invest(pool.moneyMarket, pool.borrowAmount, ZERO)).to.be.revertedWith(
          'Borrow failed'
        );
      });

      it('reverts if bad market is passed ', async () => {
        await expect(cozyInvestContract.invest(pool.badMarket, pool.borrowAmount, ZERO)).to.be.revertedWith(
          'Invalid borrow market'
        );
      });

      it('works on an ETH protection market', async () => {
        expect(await balanceOf(pool.lpToken, proxy.address)).to.equal('0');
        expect(await balanceOf(pool.gauge, proxy.address)).to.equal('0');

        const investCalldata = cozyInvestContract.interface.encodeFunctionData('invest', [
          pool.protectionMarket,
          pool.borrowAmount,
          ZERO,
        ]);
        const tx = await proxy['execute(address,bytes)'](cozyInvestContract.address, investCalldata);
        await expectSuccess(tx.hash);

        expect(await balanceOf(pool.lpToken, proxy.address)).to.equal('0');
        expect(await balanceOf(pool.gauge, proxy.address)).to.equal('86002711648740763597');
      });

      it('works on an ETH money market', async () => {
        expect(await balanceOf(pool.lpToken, proxy.address)).to.equal('0');
        expect(await balanceOf(pool.gauge, proxy.address)).to.equal('0');

        const investCalldata = cozyInvestContract.interface.encodeFunctionData('invest', [
          pool.moneyMarket,
          pool.borrowAmount,
          ZERO,
        ]);
        const tx = await proxy['execute(address,bytes)'](cozyInvestContract.address, investCalldata);
        await expectSuccess(tx.hash);

        expect(await balanceOf(pool.lpToken, proxy.address)).to.equal('0');
        expect(await balanceOf(pool.gauge, proxy.address)).to.equal('86002711648740763597');
      });

      it('allows invest to be called twice', async () => {
        expect(await balanceOf(pool.lpToken, proxy.address)).to.equal('0');
        expect(await balanceOf(pool.gauge, proxy.address)).to.equal('0');

        const investCalldata = cozyInvestContract.interface.encodeFunctionData('invest', [
          pool.protectionMarket,
          BigNumber.from(pool.borrowAmount).div(3), // invest a third in each transaction
          ZERO,
        ]);
        const tx = await proxy['execute(address,bytes)'](cozyInvestContract.address, investCalldata);
        await expectSuccess(tx.hash);
        const tx2 = await proxy['execute(address,bytes)'](cozyInvestContract.address, investCalldata);
        await expectSuccess(tx2.hash);

        expect(await balanceOf(pool.lpToken, proxy.address)).to.equal('0');
        expect(await balanceOf(pool.gauge, proxy.address)).to.equal('57339158442478860560');
      });
    });

    describe('divest', () => {
      beforeEach(async () => {
        ({ proxy, user, cozyInvestContract } = await loadFixture(setup));

        // Call invest
        const investCalldata = cozyInvestContract.interface.encodeFunctionData('invest', [
          pool.protectionMarket,
          pool.borrowAmount,
          ZERO,
        ]);
        const investTx = await proxy['execute(address,bytes)'](cozyInvestContract.address, investCalldata);
        await expectSuccess(investTx.hash);
      });

      it('reverts if bad market is passed ', async () => {
        const balance = await balanceOf(pool.lpToken, proxy.address);
        await expect(cozyInvestContract.divest(pool.badMarket, user.address, balance, ZERO)).to.be.revertedWith(
          'Invalid borrow market'
        );
      });

      it('works, full divest, without full debt repayment', async () => {
        const initialProxyGaugeStakedBalance = await balanceOf(pool.gauge, proxy.address);
        const initialUserBalance = await balanceOf('eth', user.address);

        // Call divest
        const divestCalldata = cozyInvestContract.interface.encodeFunctionData('divest', [
          pool.protectionMarket,
          user.address,
          initialProxyGaugeStakedBalance,
          ZERO,
        ]);
        const tx = await proxy['execute(address,bytes)'](cozyInvestContract.address, divestCalldata, overrides);
        await expectSuccess(tx.hash);

        // Balance of staked curve lp tokens should be 0 after divest
        expect(await balanceOf(pool.gauge, proxy.address)).to.equal('0');

        // Balance of curve lp tokens in proxy wallet should be 0
        expect(await balanceOf(pool.lpToken, proxy.address)).to.equal('0');

        // Balance of ETH in proxy wallet should be 0 after full divest
        expect(await balanceOf('eth', proxy.address)).to.equal('0');

        const ethMarket = new Contract(pool.protectionMarket, cozyTokenAbi, ethers.provider);
        // Expect debt to not be cleared as full divest did not cover the entire debt
        expect(await ethMarket.borrowBalanceStored(proxy.address)).to.equal('65677580214291075');

        // Balance of user wallet should be equal to initial user balance, as the debt was not cleared
        expect(await balanceOf('eth', user.address)).to.equal(initialUserBalance.toString());
      });

      it('works, full divest, when sending extra ETH to fully repay debt', async () => {
        // Call divest
        const initialProxyGaugeStakedBalance = await balanceOf(pool.gauge, proxy.address);
        const divestCalldata = cozyInvestContract.interface.encodeFunctionData('divest', [
          pool.protectionMarket,
          user.address,
          initialProxyGaugeStakedBalance,
          ZERO,
        ]);

        const tx = await proxy['execute(address,bytes)'](cozyInvestContract.address, divestCalldata, {
          ...overrides,
          value: pool.borrowAmount, // extra ETH
        });
        await expectSuccess(tx.hash);

        // Balance of staked curve lp tokens should be 0 after divest
        expect(await balanceOf(pool.gauge, proxy.address)).to.equal('0');

        // Balance of curve lp tokens in proxy wallet should be 0
        expect(await balanceOf(pool.lpToken, proxy.address)).to.equal('0');

        // Balance of ETH in proxy wallet should be 0 after full divest
        expect(await balanceOf('eth', proxy.address)).to.equal('0');

        const ethMarket = new Contract(pool.protectionMarket, cozyTokenAbi, ethers.provider);
        // Expect debt to be cleared after full divest + extra ETH sent to repay debt
        expect(await ethMarket.borrowBalanceStored(proxy.address)).to.equal(0);

        // Balance of user wallet after clearing debt and redeeming curve lp tokens
        expect(await balanceOf('eth', user.address)).to.equal('9999932850233785708925');
      });

      it('works, partial divest', async () => {
        const initialProxyGaugeStakedBalance = await balanceOf(pool.gauge, proxy.address);
        const initialUserBalance = await balanceOf('eth', user.address);

        // Call divest
        const divestCalldata = cozyInvestContract.interface.encodeFunctionData('divest', [
          pool.protectionMarket,
          user.address,
          initialProxyGaugeStakedBalance.div(3), // withdraw a third of the curve lp tokens
          ZERO,
        ]);
        const tx = await proxy['execute(address,bytes)'](cozyInvestContract.address, divestCalldata, overrides);
        await expectSuccess(tx.hash);

        // Balance of staked curve lp tokens should be 2/3 of the balance before divest
        expect(await balanceOf(pool.gauge, proxy.address)).to.equal(
          initialProxyGaugeStakedBalance.sub(initialProxyGaugeStakedBalance.div(3))
        );

        // Balance of curve lp tokens in proxy wallet should be 0
        expect(await balanceOf(pool.lpToken, proxy.address)).to.equal('0');

        // Balance of proxy wallet should be 0 after divest
        expect(await balanceOf('eth', proxy.address)).to.equal('0');

        const ethMarket = new Contract(pool.protectionMarket, cozyTokenAbi, ethers.provider);
        // Expect debt to not be cleared as partial divest did not cover the entire debt
        expect(await ethMarket.borrowBalanceStored(proxy.address)).to.equal('26686802197494584329');

        // Balance of user wallet should be the same as before divest, as the debt was not fully cleared
        expect(await balanceOf('eth', user.address)).to.equal(initialUserBalance.toString());
      });

      it('works, partial divest, when sending extra tokens to repay debt', async () => {
        const initialProxyGaugeStakedBalance = await balanceOf(pool.gauge, proxy.address);

        // Call divest
        const divestCalldata = cozyInvestContract.interface.encodeFunctionData('divest', [
          pool.protectionMarket,
          user.address,
          initialProxyGaugeStakedBalance.div(3), // withdraw a third of the curve lp tokens
          ZERO,
        ]);
        const tx = await proxy['execute(address,bytes)'](cozyInvestContract.address, divestCalldata, {
          ...overrides,
          value: pool.borrowAmount, // extra ETH
        });
        await expectSuccess(tx.hash);

        // Balance of staked curve lp tokens should be 2/3 of the balance before divest
        expect(await balanceOf(pool.gauge, proxy.address)).to.equal(
          initialProxyGaugeStakedBalance.sub(initialProxyGaugeStakedBalance.div(3))
        );

        // Balance of curve lp tokens in proxy wallet should be 0
        expect(await balanceOf(pool.lpToken, proxy.address)).to.equal('0');

        // Balance of proxy wallet should be 0 after divest
        expect(await balanceOf('eth', proxy.address)).to.equal('0');

        const ethMarket = new Contract(pool.protectionMarket, cozyTokenAbi, ethers.provider);
        // Expect debt to be cleared after partial divest + extra ETH sent to repay debt
        expect(await ethMarket.borrowBalanceStored(proxy.address)).to.equal(0);

        // Balance of user wallet after clearing debt and redeeming curve lp tokens
        expect(await balanceOf('eth', user.address)).to.equal('9973311725616505415671');
      });

      it('allows divest to be called twice', async () => {
        const initialProxyGaugeStakedBalance = await balanceOf(pool.gauge, proxy.address);

        // Call divest
        const divestCalldata = cozyInvestContract.interface.encodeFunctionData('divest', [
          pool.protectionMarket,
          user.address,
          initialProxyGaugeStakedBalance.div(3), // withdraw a third of the curve lp tokens
          ZERO,
        ]);
        const tx = await proxy['execute(address,bytes)'](cozyInvestContract.address, divestCalldata, overrides);
        await expectSuccess(tx.hash);
        const tx2 = await proxy['execute(address,bytes)'](cozyInvestContract.address, divestCalldata, overrides);
        await expectSuccess(tx2.hash);
      });
    });
  });
});
