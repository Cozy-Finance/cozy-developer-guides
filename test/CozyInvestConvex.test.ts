// --- Imports ---
import { artifacts, ethers, network, waffle } from 'hardhat';
import { expect } from 'chai';
import { Contract } from 'ethers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/dist/src/signer-with-address';
import { balanceOf, buildProxy, expectSuccess, mint, prepareProtectionMarket, setBalance, SupportedToken, reset } from './utils'; // prettier-ignore
import { CozyInvestConvex } from '../typechain';

const { deployContract, loadFixture } = waffle;
const overrides = { maxFeePerGas: 0, maxPriorityFeePerGas: 0, gasLimit: 10000000 };
const ZERO = ethers.constants.Zero;

// Pools
const pools = [
  // FRAX
  {
    name: 'FRAX',
    underlying: 'USDC',
    mintAmount: 1000n * 10n ** 6n,
    borrowAmount: 100n * 10n ** 6n,
    balanceAmount: 1000n * 10n ** 6n,
    badMarket: '0xf146c26136C1F80c9f0967d27BCb7E500D45681f', // BTC market
    // Params
    moneyMarket: '0xdBDF2fC3Af896e18f2A9DC58883d12484202b57E',
    protectionMarket: '0x11581582Aa816c8293e67c726AF49Fc2C8b98C6e',
    underlyingAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    curveDepositZap: '0xA79828DF1850E8a3A3064576f380D90aECDD3359',
    convexPoolId: 32,
    curveIndex: 2,
    isMetapool: true,
    // Constants
    curveLpToken: '0xd632f22692FaC7611d2AA1C0D552930D43CAEd3B',
    convexToken: '0xbE0F6478E0E4894CFb14f32855603A083A57c7dA',
    convexRewardPool: '0xB900EF131301B307dB5eFcbed9DBb50A3e209B2e',
    rewardToken: '0xD533a949740bb3306d119CC777fa900bA034cd52', // CRV
    // Magic numbers
    expectedMoneyMarketConvexAmount: '99332386954442393035',
    expectedProtectionMarketConvexAmount: '99332386954442393035',
    expectedFirstInvestBalance: '99332386954442393035',
    expectedSecondInvestBalance: '198664773874086458434',
    expectedUnderlyingAmount: '999999999999930901',
    expectedEarnedAmount: '58150796977420210',
    expectedRewardAmount: '58150796977420210',
    expectedPartialDivestConvexReward: '74499290215831794777',
    extraRewardTokens: [
      {
        // FRAX
        address: '0x3432B6A60D23Ca0dFCa7761B7ab56459D9C964D0',
        expectedEarned: '541941091623612',
      },
    ],
  },
  // USDP (28)
  {
    name: 'USDP',
    underlying: 'USDC',
    mintAmount: 1000n * 10n ** 6n,
    borrowAmount: 100n * 10n ** 6n,
    balanceAmount: 1000n * 10n ** 6n,
    badMarket: '0xf146c26136C1F80c9f0967d27BCb7E500D45681f', // BTC market
    // Params
    moneyMarket: '0xdBDF2fC3Af896e18f2A9DC58883d12484202b57E',
    protectionMarket: '0x11581582Aa816c8293e67c726AF49Fc2C8b98C6e',
    underlyingAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    curveDepositZap: '0x3c8cAee4E09296800f8D29A68Fa3837e2dae4940',
    convexPoolId: 28,
    curveIndex: 2,
    isMetapool: false,
    // Constants
    curveLpToken: '0x7Eb40E450b9655f4B3cC4259BCC731c63ff55ae6',
    convexToken: '0x7a5dC1FA2e1B10194bD2e2e9F1A224971A681444',
    convexRewardPool: '0x24DfFd1949F888F91A0c8341Fc98a3F280a782a8',
    rewardToken: '0xD533a949740bb3306d119CC777fa900bA034cd52', // CRV
    // Magic numbers
    expectedMoneyMarketConvexAmount: '99498139393396091843',
    expectedProtectionMarketConvexAmount: '99498139393396091843',
    expectedFirstInvestBalance: '99498139393396091843',
    expectedSecondInvestBalance: '198996277116503162345',
    expectedUnderlyingAmount: '999999999999925474',
    expectedEarnedAmount: '27214794484576728',
    expectedRewardAmount: '27214794484576728',
    expectedPartialDivestConvexReward: '74623604545047068883',
    extraRewardTokens: [
      {
        // DUCK
        address: '0x92E187a03B6CD19CB6AF293ba17F2745Fd2357D5',
        expectedEarned: '186233145193090754',
      },
    ],
  },
  // alUSD (36)
  {
    name: 'alUSD',
    underlying: 'USDC',
    mintAmount: 1000n * 10n ** 6n,
    borrowAmount: 100n * 10n ** 6n,
    balanceAmount: 1000n * 10n ** 6n,
    badMarket: '0xf146c26136C1F80c9f0967d27BCb7E500D45681f', // BTC market
    // Params
    moneyMarket: '0xdBDF2fC3Af896e18f2A9DC58883d12484202b57E', // USDC money market
    protectionMarket: '0x11581582Aa816c8293e67c726AF49Fc2C8b98C6e', // USDC protection market
    underlyingAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC mint address
    curveDepositZap: '0xA79828DF1850E8a3A3064576f380D90aECDD3359',
    convexPoolId: 36,
    curveIndex: 2,
    isMetapool: true,
    // Constants
    curveLpToken: '0x43b4FdFD4Ff969587185cDB6f0BD875c5Fc83f8c',
    convexToken: '0xCA3D9F45FfA69ED454E66539298709cb2dB8cA61',
    convexRewardPool: '0x02E2151D4F351881017ABdF2DD2b51150841d5B3',
    rewardToken: '0xD533a949740bb3306d119CC777fa900bA034cd52', // CRV
    // Magic numbers
    expectedMoneyMarketConvexAmount: '99233144268656678728',
    expectedProtectionMarketConvexAmount: '99233144268656678728',
    expectedFirstInvestBalance: '99233144268656678728',
    expectedSecondInvestBalance: '198466288441230859764',
    expectedUnderlyingAmount: '999999999999932369',
    expectedEarnedAmount: '5213545122687120',
    expectedRewardAmount: '5213545122687120',
    expectedPartialDivestConvexReward: '74424858201492509046',
    expectedPartialDivestUnderlyingAmount: '18908494840230166354',
    extraRewardTokens: [
      {
        // ALCX
        address: '0xdBdb4d16EdA451D0503b854CF79D55697F90c8DF',
        expectedEarned: '298096330751768',
      },
    ],
  },
  // tBTC v4 (16)
  {
    name: 'tBTC',
    underlying: 'WBTC',
    mintAmount: 10n * 10n ** 8n,
    borrowAmount: 1n * 10n ** 8n,
    balanceAmount: 10n * 10n ** 8n,
    badMarket: '0xdBDF2fC3Af896e18f2A9DC58883d12484202b57E', // USDC market
    // Params
    moneyMarket: '0xf146c26136C1F80c9f0967d27BCb7E500D45681f', // WBTC money market
    protectionMarket: '0xf146c26136C1F80c9f0967d27BCb7E500D45681f', // WBTC protection market
    underlyingAddress: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599', // WBTC underlying address
    curveDepositZap: '0xaa82ca713D94bBA7A89CEAB55314F9EfFEdDc78c',
    convexPoolId: 16,
    curveIndex: 2,
    isMetapool: false,
    // Constants
    curveLpToken: '0x64eda51d3Ad40D56b9dFc5554E06F94e1Dd786Fd',
    convexToken: '0x36CED690A1516861f26755b978EE62c1157CFFF9',
    convexRewardPool: '0x081A6672f07B615B402e7558a867C97FA080Ce35',
    rewardToken: '0xD533a949740bb3306d119CC777fa900bA034cd52', // CRV
    // Magic numbers
    expectedMoneyMarketConvexAmount: '989614701095330989',
    expectedProtectionMarketConvexAmount: '989614701095330989',
    expectedFirstInvestBalance: '989614701095330989',
    expectedSecondInvestBalance: '1979222229668308237',
    expectedUnderlyingAmount: '999999999999943022',
    expectedEarnedAmount: '18908527016467952926',
    expectedRewardAmount: '18908527016467952926',
    expectedPartialDivestConvexReward: '742211025821498242',
    expectedPartialDivestUnderlyingAmount: '18908494840230166354',
    extraRewardTokens: [
      {
        address: '0x85Eee30c52B0b379b046Fb0F85F4f3Dc3009aFEC', // KEEP
        expectedEarned: '0',
      },
    ],
  },
];

const convexRewardAbi = ['function earned(address account) public view returns (uint256)'];

// --- Tests ---
pools.forEach((pool) => {
  describe(`Convex Pool: ${pool.name}`, function () {
    let proxy: Contract;
    let user: SignerWithAddress;
    let cozyInvestContract: CozyInvestConvex;
    async function setup() {
      await reset();

      const [deployer, user] = await ethers.getSigners();

      // Deploy invest contract
      const cozyInvestContractArtifact = await artifacts.readArtifactSync('CozyInvestConvex');
      const cozyInvestContract = <CozyInvestConvex>(
        await deployContract(deployer, cozyInvestContractArtifact, [
          pool.moneyMarket,
          pool.protectionMarket,
          pool.underlyingAddress,
          pool.curveDepositZap,
          pool.convexPoolId,
          pool.curveIndex,
          pool.isMetapool,
        ])
      );

      // Deploy user a proxy wallet
      const proxy = await buildProxy(user);

      // Supply protection to market
      await prepareProtectionMarket({
        account: deployer,
        market: pool.protectionMarket,
        token: pool.underlying.toLowerCase() as SupportedToken,
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
        await expect(cozyInvestContract.invest(pool.moneyMarket, pool.borrowAmount, 0)).to.be.revertedWith(
          'Borrow failed'
        );
      });

      it('works on a protection market', async () => {
        expect(await balanceOf(pool.convexRewardPool, proxy.address)).to.equal('0');
        const investCalldata = cozyInvestContract.interface.encodeFunctionData('invest', [
          pool.protectionMarket,
          pool.borrowAmount,
          0,
        ]);
        const tx = await proxy['execute(address,bytes)'](cozyInvestContract.address, investCalldata);
        await expectSuccess(tx.hash);

        // Balance should be zero (all deposited in convex)
        expect(await balanceOf(pool.curveLpToken, proxy.address)).to.equal('0');
        // Balance in convex should be nonzero
        expect(await balanceOf(pool.convexRewardPool, proxy.address)).to.equal(
          pool.expectedProtectionMarketConvexAmount
        );
      });

      it('works on a regular money market', async () => {
        expect(await balanceOf(pool.convexRewardPool, proxy.address)).to.equal('0');

        const investCalldata = cozyInvestContract.interface.encodeFunctionData('invest', [
          pool.moneyMarket,
          pool.borrowAmount,
          0,
        ]);
        const tx = await proxy['execute(address,bytes)'](cozyInvestContract.address, investCalldata);
        await expectSuccess(tx.hash);

        // Balance of FRAX3CRV should be zero (all deposited in convex)
        expect(await balanceOf(pool.curveLpToken, proxy.address)).to.equal('0');
        // Balance in convex should be nonzero
        expect(await balanceOf(pool.convexRewardPool, proxy.address)).to.equal(pool.expectedMoneyMarketConvexAmount);
      });

      it('reverts if bad market is passed', async () => {
        await expect(cozyInvestContract.invest(pool.badMarket, pool.borrowAmount, 0)).to.be.revertedWith(
          'Invalid borrow market'
        );
      });

      it('works twice', async () => {
        expect(await balanceOf(pool.convexRewardPool, proxy.address)).to.equal('0');
        const investCalldata = cozyInvestContract.interface.encodeFunctionData('invest', [
          pool.protectionMarket,
          pool.borrowAmount,
          0,
        ]);
        const tx = await proxy['execute(address,bytes)'](cozyInvestContract.address, investCalldata);
        await expectSuccess(tx.hash);

        // Balance should be zero (all deposited in convex)
        expect(await balanceOf(pool.curveLpToken, proxy.address)).to.equal('0');
        // Balance in convex should be nonzero
        expect(await balanceOf(pool.convexRewardPool, proxy.address)).to.equal(pool.expectedFirstInvestBalance);

        const tx2 = await proxy['execute(address,bytes)'](cozyInvestContract.address, investCalldata);
        await expectSuccess(tx2.hash);

        // Balance should be zero (all deposited in convex)
        expect(await balanceOf(pool.curveLpToken, proxy.address)).to.equal('0');
        // Balance in convex should be nonzero
        expect(await balanceOf(pool.convexRewardPool, proxy.address)).to.equal(pool.expectedSecondInvestBalance);
      });
    });

    describe('divest', () => {
      beforeEach(async () => {
        await setup();
        // Call invest
        const investCalldata = cozyInvestContract.interface.encodeFunctionData('invest', [
          pool.protectionMarket,
          pool.borrowAmount,
          0,
        ]);
        const investTx = await proxy['execute(address,bytes)'](cozyInvestContract.address, investCalldata);
        await expectSuccess(investTx.hash);
      });

      it('works, full divest, when proxy has sufficient balance', async () => {
        // Set proxy balance to 10^18 (simulates earning tokens so user has excess after redeeming receipt tokens)
        await setBalance(pool.underlying.toLowerCase() as SupportedToken, proxy.address, 10n ** 18n);
        const convexReward = new Contract(pool.convexRewardPool, convexRewardAbi, user);

        // Since rewards is based on timestamp, set this fixed timestamp
        await network.provider.send('evm_setNextBlockTimestamp', [1638133646]);
        await network.provider.send('evm_mine');

        // Call divest
        const balance = await balanceOf(pool.convexRewardPool, proxy.address);
        const divestCalldata = cozyInvestContract.interface.encodeFunctionData('divest', [
          pool.protectionMarket,
          user.address,
          balance,
          0,
          0,
        ]);
        const tx = await proxy['execute(address,bytes)'](cozyInvestContract.address, divestCalldata, overrides);
        await expectSuccess(tx.hash);

        // Assertions
        // Balance of convex reward pool should be 0
        expect(await balanceOf(pool.convexRewardPool, proxy.address)).to.equal('0');

        // Balance of curve LP token should be 0
        expect(await balanceOf(pool.curveLpToken, proxy.address)).to.equal('0');

        // Balance of underlying should be higher
        expect(await balanceOf(pool.underlyingAddress, proxy.address)).to.equal('0');
        expect(await balanceOf(pool.underlyingAddress, user.address)).to.equal(pool.expectedUnderlyingAmount);

        // Check rewards
        expect(await balanceOf(pool.rewardToken, proxy.address)).to.equal(ZERO);
        expect(await balanceOf(pool.rewardToken, user.address)).to.equal(pool.expectedRewardAmount);
      });

      it('works, partial divest', async () => {
        const convexReward = new Contract(pool.convexRewardPool, convexRewardAbi, user);

        // Since rewards is based on timestamp, set this fixed timestamp
        await network.provider.send('evm_setNextBlockTimestamp', [1638133646]);
        await network.provider.send('evm_mine');

        // Call divest
        const balance = await balanceOf(pool.convexRewardPool, proxy.address);
        const amount = balance.mul(25).div(100); // withdraw 25%
        const divestCalldata = cozyInvestContract.interface.encodeFunctionData('divest', [
          pool.protectionMarket,
          user.address,
          amount,
          0,
          0,
        ]);
        const tx = await proxy['execute(address,bytes)'](cozyInvestContract.address, divestCalldata, overrides);
        await expectSuccess(tx.hash);

        // Assertions
        // Balance of convex reward pool should be 0
        expect(await balanceOf(pool.convexRewardPool, proxy.address)).to.equal(pool.expectedPartialDivestConvexReward);

        // Balance of curve LP token should be 0
        expect(await balanceOf(pool.curveLpToken, proxy.address)).to.equal('0');

        // Balance of underlying in proxy should be higher
        expect(await balanceOf(pool.underlyingAddress, proxy.address)).to.equal('0');
        expect(await balanceOf(pool.underlyingAddress, user.address)).to.equal('0');

        // Check rewards
        expect(await balanceOf(pool.rewardToken, proxy.address)).to.equal(ZERO);
        expect(await balanceOf(pool.rewardToken, user.address)).to.equal(pool.expectedRewardAmount);
      });

      it('getting rewards works', async () => {
        const convexReward = new Contract(pool.convexRewardPool, convexRewardAbi, user);
        // Should have no rewards right after depositing
        expect(await convexReward.earned(proxy.address)).to.equal(ZERO);

        // Since rewards is based on timestamp, set this fixed timestamp
        await network.provider.send('evm_setNextBlockTimestamp', [1638133646]);
        await network.provider.send('evm_mine');

        // This should be greater than zero now
        expect(await convexReward.earned(proxy.address)).to.equal(pool.expectedEarnedAmount);

        const extra = await balanceOf(pool.extraRewardTokens[0].address, proxy.address);

        const claimRewardsCalldata = cozyInvestContract.interface.encodeFunctionData('claimRewards', [user.address]);
        const tx = await proxy['execute(address,bytes)'](cozyInvestContract.address, claimRewardsCalldata);
        await expectSuccess(tx.hash);

        // This should be zero again now
        expect(await convexReward.earned(proxy.address)).to.equal(ZERO);

        // We should have reward tokens now in user wallet
        expect(await balanceOf(pool.rewardToken, proxy.address)).to.equal(ZERO);
        expect(await balanceOf(pool.rewardToken, user.address)).to.equal(pool.expectedRewardAmount);
        for (const extraRewardToken of pool.extraRewardTokens) {
          expect(await balanceOf(extraRewardToken.address, proxy.address)).to.equal(ZERO);
          expect(await balanceOf(extraRewardToken.address, user.address)).to.equal(extraRewardToken.expectedEarned);
        }
      });
    });
  });
});
