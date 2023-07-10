import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { Signer } from 'ethers';
import { ethers } from 'hardhat'
import { IERC20, HashflowRouterMock } from '../../typechain-types';
// import { HashflowRouterMock } from '../../typechain-types/contracts/mocks/HashflowRouterMock.sol';
import { Trader } from '../../typechain-types/contracts/trade';
import { lastBlockTime, delay, getSaleId, expectCloseEnough } from '../lib'

jest.setTimeout(30000);

let hashflowRouterMock: HashflowRouterMock
let trader: Trader
let deployer: SignerWithAddress
let maker: SignerWithAddress
let taker: SignerWithAddress
let feeRecipient: SignerWithAddress
let randomSigner: SignerWithAddress
let pool: SignerWithAddress
let baseToken: IERC20
let quoteToken: IERC20
const feeBips = 250n // 2.5%

// get the balance of a signer
const getBalance = async (signer: SignerWithAddress): Promise<bigint> => {
  return BigInt((await ethers.provider.getBalance(signer.address)).toString())
}

describe.skip("Trader", function () {
  beforeAll(async () => {
    // We will use these accounts for testing
    [deployer, maker, taker, feeRecipient, randomSigner, pool ] = await ethers.getSigners();

    const GenericERC20Factory = await ethers.getContractFactory("GenericERC20");

    baseToken = await GenericERC20Factory.deploy(
      "US Dollar Coin",
      "USDC",
      6,
      "1000000000000000"
    ) as IERC20;

    quoteToken = await GenericERC20Factory.deploy(
      "Graph Token",
      "GRT",
      18,
      "1000000000000000"
    ) as IERC20;
		
		const hashflowRouterMockFactory = await ethers.getContractFactory("HashflowRouterMock");
		hashflowRouterMock = await hashflowRouterMockFactory.deploy() as HashflowRouterMock

		const traderFactory = await ethers.getContractFactory("Trader");
		trader = await traderFactory.deploy(
			hashflowRouterMock.address,
			feeBips,
			feeRecipient.address
		) as Trader

		// the taker starts with 10% of the token they wish to sell
		baseToken.transfer(taker.address, "100000000000000")
		// the maker starts with 10% of the token they wish to sell
		quoteToken.transfer(maker.address, "100000000000000")

		// get 100 ETH to the mock hashflow router so it can pretend to settle native token trades
		await hashflowRouterMock.depositEth({value: 1n ** 10n ** 21n})
	})

	it("Initial configuration is correct", async () => {
		const [_router, _feeBips, _feeRecipient] = await trader.getConfig()
		expect(_router).toBe(hashflowRouterMock.address)
		expect(_feeBips.toBigInt()).toBe(feeBips)
		expect(_feeRecipient).toBe(feeRecipient.address)
	})

	it("Cannot accidentally trade with an invalid router contract", async () => {
		// TODO
	})

	it("Calculates total, base amount, and fee correctly", async () => {
		const [_router, _feeBips, _feeRecipient] = await trader.getConfig()

		const estimatedTotal = 123456n;
		const estimatedFee = estimatedTotal * feeBips / 10000n
		const estimatedBase = estimatedTotal - estimatedFee

		const [finalTotal, finalBase, finalFee] = (await trader.getSplit(estimatedTotal)).map(v => v.toBigInt())

		console.log('***', {estimatedTotal, estimatedBase, estimatedFee, finalTotal, finalBase, finalFee})
		
		// verify final on-chain values are close enough
		expectCloseEnough(estimatedTotal, finalTotal, 1n)
		expectCloseEnough(estimatedBase, finalBase, 1n)
		expectCloseEnough(estimatedFee, finalFee, 1n)

		// verify the on-chain math is consistent
		expect(finalBase + finalFee).toEqual(finalTotal)
		expect((await trader.getFee(finalBase)).toBigInt()).toEqual(finalFee)
	})

	it("handles intra-chain ERC20<>ERC20 trade", async () => {
		const initialBaseTokenTakerBalance = (await baseToken.balanceOf(taker.address)).toBigInt()
		const initialQuoteTokenTakerBalance = (await quoteToken.balanceOf(taker.address)).toBigInt()

		const initialBaseTokenMakerBalance = (await baseToken.balanceOf(maker.address)).toBigInt()
		const initialQuoteTokenMakerBalance = (await quoteToken.balanceOf(maker.address)).toBigInt()

		const initialBaseTokenFeeRecipientBalance = (await baseToken.balanceOf(feeRecipient.address)).toBigInt()
		const initialQuoteTokenFeeRecipientBalance = (await quoteToken.balanceOf(feeRecipient.address)).toBigInt()

		// only a faction of the maker quote is filled
		const effectiveBaseTokenAmount = 2100n
		const maxBaseTokenAmount = 2222n
		const maxQuoteTokenAmount = 111n
		const effectiveQuoteTokenAmount = maxQuoteTokenAmount * effectiveBaseTokenAmount / maxBaseTokenAmount

		const baseTokenFee = effectiveBaseTokenAmount * feeBips / (10000n - feeBips)

    let myToken = await ethers.getContractAt("GenericERC20", baseToken.address, taker)


		// approve the trader to move base tokens (including the fee)
		await myToken.approve(trader.address, baseTokenFee + effectiveBaseTokenAmount)
	
		// approve the hashflow mock to move quote tokens
    myToken = await ethers.getContractAt("GenericERC20", quoteToken.address, maker)
		await myToken.approve(hashflowRouterMock.address, effectiveQuoteTokenAmount)

		const myTrader = await ethers.getContractAt("Trader", trader.address, taker)

		// most of these values are not used in the mock and can be faked
		await myTrader.tradeSingleHop({
			pool: randomSigner.address,
			externalAccount: maker.address,
			trader: taker.address,
			effectiveTrader: taker.address,
			baseToken: baseToken.address,
			quoteToken: quoteToken.address,
			effectiveBaseTokenAmount,
			maxBaseTokenAmount,
		  maxQuoteTokenAmount,
			quoteExpiry: 0,
			nonce: 0,
			txid: "0x0000000000000000000000000000000000000000000000000000000000000000",
			signature: "0x00"
		})
	
		const finalBaseTokenTakerBalance = (await baseToken.balanceOf(taker.address)).toBigInt()
		const finalQuoteTokenTakerBalance = (await quoteToken.balanceOf(taker.address)).toBigInt()

		const finalBaseTokenMakerBalance = (await baseToken.balanceOf(maker.address)).toBigInt()
		const finalQuoteTokenMakerBalance = (await quoteToken.balanceOf(maker.address)).toBigInt()

		const finalBaseTokenFeeRecipientBalance = (await baseToken.balanceOf(feeRecipient.address)).toBigInt()
		const finalQuoteTokenFeeRecipientBalance = (await quoteToken.balanceOf(feeRecipient.address)).toBigInt()

		// taker pays base token fee and trade amount
		expect(initialBaseTokenTakerBalance - finalBaseTokenTakerBalance).toEqual(effectiveBaseTokenAmount + baseTokenFee)
		// taker receives quote token trade amount
		expect(finalQuoteTokenTakerBalance - initialQuoteTokenTakerBalance).toEqual(effectiveQuoteTokenAmount)

		// maker receives base token trade amount
		expect(finalBaseTokenMakerBalance - initialBaseTokenMakerBalance).toEqual(effectiveBaseTokenAmount)
		// maker pays quote token trade amount
		expect(initialQuoteTokenMakerBalance - finalQuoteTokenMakerBalance).toEqual(effectiveQuoteTokenAmount)

		// fee recipient has not received fee yet
		expect(finalBaseTokenFeeRecipientBalance - initialBaseTokenFeeRecipientBalance).toEqual(0n)
		// trader contract is holding fee but no other tokens
		expect((await baseToken.balanceOf(trader.address)).toBigInt()).toEqual(baseTokenFee)
		expect((await quoteToken.balanceOf(trader.address)).toBigInt()).toEqual(0n)

		await trader.functions["sweepToken(address)"](baseToken.address)
		// anyone can sweep the trader contract and the feeRecipient will receive the fee
		expect((await baseToken.balanceOf(trader.address)).toBigInt()).toEqual(0n)
		expect((await baseToken.balanceOf(feeRecipient.address)).toBigInt()).toEqual(baseTokenFee)

		// fee recipient quote token balance is unchanged
		expect(finalQuoteTokenFeeRecipientBalance - initialQuoteTokenFeeRecipientBalance).toEqual(0n)
	})

	it("handles intra-chain Native<>ERC20 trade", async () => {
		const baseTokenAmount = 2222n
		const quoteTokenAmount = 111n

		const baseTokenFee = baseTokenAmount * feeBips / (10000n - feeBips)

		// approve the hashflow mock to move quote tokens
    const myToken = await ethers.getContractAt("GenericERC20", quoteToken.address, maker);
		await myToken.approve(hashflowRouterMock.address, quoteTokenAmount)
	
		const initialBaseTokenTakerBalance = await getBalance(taker)
		const initialQuoteTokenTakerBalance = (await quoteToken.balanceOf(taker.address)).toBigInt()

		const initialBaseTokenMakerBalance = await getBalance(maker)
		const initialQuoteTokenMakerBalance = (await quoteToken.balanceOf(maker.address)).toBigInt()

		const initialBaseTokenFeeRecipientBalance = await getBalance(feeRecipient)
		const initialQuoteTokenFeeRecipientBalance = (await quoteToken.balanceOf(feeRecipient.address)).toBigInt()

		const initialBaseTokenTraderBalance = BigInt((await ethers.provider.getBalance(trader.address)).toString())
		const initialQuoteTokenTraderBalance = (await quoteToken.balanceOf(trader.address)).toBigInt()

    const myTrader = await ethers.getContractAt("Trader", trader.address, taker) as Trader;

		// most of these values are not used in the mock and can be faked
		const tradeTxResponse = await myTrader.tradeSingleHop({
			pool: randomSigner.address,
			externalAccount: maker.address,
			trader: taker.address,
			effectiveTrader: taker.address,
			baseToken: ethers.constants.AddressZero, // this indicates the base token is the native token
			quoteToken: quoteToken.address,
			effectiveBaseTokenAmount: baseTokenAmount,
			maxBaseTokenAmount: baseTokenAmount,
			maxQuoteTokenAmount: quoteTokenAmount,
			quoteExpiry: 0,
			nonce: 0,
			txid: "0x0000000000000000000000000000000000000000000000000000000000000000",
			signature: "0x00"
		}, {value: baseTokenAmount + baseTokenFee})

		const tradeTxReceipt = await tradeTxResponse.wait()

		// move fee tokens to fee recipient
		await trader['sweepNative()']()
	
		const finalBaseTokenTakerBalance = await getBalance(taker)
		const finalQuoteTokenTakerBalance = (await quoteToken.balanceOf(taker.address)).toBigInt()

		const finalBaseTokenMakerBalance =  await getBalance(maker)
		const finalQuoteTokenMakerBalance = (await quoteToken.balanceOf(maker.address)).toBigInt()

		const finalBaseTokenFeeRecipientBalance =  await getBalance(feeRecipient)
		const finalQuoteTokenFeeRecipientBalance = (await quoteToken.balanceOf(feeRecipient.address)).toBigInt()

		const finalBaseTokenTraderBalance = BigInt((await ethers.provider.getBalance(trader.address)).toString())
		const finalQuoteTokenTraderBalance = (await quoteToken.balanceOf(trader.address)).toBigInt()

		// taker pays base token fee and trade amount
		expect(initialBaseTokenTakerBalance - finalBaseTokenTakerBalance).toEqual(baseTokenAmount + baseTokenFee + tradeTxReceipt.gasUsed.toBigInt() * tradeTxReceipt.effectiveGasPrice.toBigInt())
		// taker receives quote token trade amount
		expect(finalQuoteTokenTakerBalance - initialQuoteTokenTakerBalance).toEqual(quoteTokenAmount)

		// maker receives base token trade amount
		expect(finalBaseTokenMakerBalance - initialBaseTokenMakerBalance).toEqual(baseTokenAmount)
		// maker pays quote token trade amount
		expect(initialQuoteTokenMakerBalance - finalQuoteTokenMakerBalance).toEqual(quoteTokenAmount)

		// fee recipient receives base token fee after sweeping
		expect(finalBaseTokenFeeRecipientBalance - initialBaseTokenFeeRecipientBalance).toEqual(baseTokenFee)
		expect(finalBaseTokenTraderBalance - initialBaseTokenTraderBalance).toEqual(0n)

		// fee recipient quote token balance is unchanged
		expect(finalQuoteTokenFeeRecipientBalance - initialQuoteTokenFeeRecipientBalance).toEqual(0n)

		// trader quote token balance is unchanged
		expect(finalQuoteTokenTraderBalance - initialQuoteTokenTraderBalance).toEqual(0n)
	})


	it("handles cross-chain ERC20<>??? trade", async () => {
		const baseTokenAmount = 2222n
		const quoteTokenAmount = 111n

		const baseTokenFee = baseTokenAmount * feeBips / (10000n - feeBips)

		// approve the hashflow mock to move quote tokens

		const initialBaseTokenTakerBalance = (await baseToken.balanceOf(taker.address)).toBigInt()
		const initialBaseTokenPoolBalance = (await baseToken.balanceOf(pool.address)).toBigInt()
		const initialBaseTokenFeeRecipientBalance = (await baseToken.balanceOf(feeRecipient.address)).toBigInt()
		const initialBaseTokenTraderBalance = (await baseToken.balanceOf(trader.address)).toBigInt()

		const myToken = await ethers.getContractAt("GenericERC20", baseToken.address, taker)

		// approve the trader to move base tokens (including the fee)
		await myToken.approve(trader.address, baseTokenFee + baseTokenAmount)

    const myTrader = await ethers.getContractAt("Trader", trader.address, taker) as Trader;

		const crossChainFee =  (await hashflowRouterMock.estimateCrossChainFee()).toBigInt()
		// most of these values are not used in the mock and can be faked
		const tradeTxResponse = await myTrader.tradeXChain({
				srcChainId: '1',
				dstChainId: '2',
				srcPool: pool.address,
				dstPool: ethers.constants.HashZero,
				srcExternalAccount: ethers.constants.AddressZero,
				dstExternalAccount: ethers.constants.HashZero,
				trader: taker.address,
				baseToken: baseToken.address,
				quoteToken: ethers.constants.AddressZero,
				baseTokenAmount,
				quoteTokenAmount,
				quoteExpiry: 0,
				nonce: 0,
				txid: ethers.constants.HashZero,
				signature: "0x00"
			},
			ethers.constants.AddressZero,
			{value: crossChainFee}
		)

		const tradeTxReceipt = await tradeTxResponse.wait()

		// move fee tokens to fee recipient
		await trader.functions["sweepToken(address)"](baseToken.address)

		const finalBaseTokenTakerBalance = (await baseToken.balanceOf(taker.address)).toBigInt()
		const finalBaseTokenPoolBalance = (await baseToken.balanceOf(pool.address)).toBigInt()
		const finalBaseTokenFeeRecipientBalance = (await baseToken.balanceOf(feeRecipient.address)).toBigInt()
		const finalBaseTokenTraderBalance = (await baseToken.balanceOf(trader.address)).toBigInt()

		// taker pays base token fee and trade amount
		expect(initialBaseTokenTakerBalance - finalBaseTokenTakerBalance).toEqual(baseTokenAmount + baseTokenFee)
	
		// maker receives base token trade amount
		expect(finalBaseTokenPoolBalance - initialBaseTokenPoolBalance).toEqual(baseTokenAmount)

		// fee recipient receives base token fee after sweeping
		expect(finalBaseTokenFeeRecipientBalance - initialBaseTokenFeeRecipientBalance).toEqual(baseTokenFee)
		expect(finalBaseTokenTraderBalance - initialBaseTokenTraderBalance).toEqual(0n)
	})


	it("handles cross-chain Native<>??? trade", async () => {
		const baseTokenAmount = 2222n
		const quoteTokenAmount = 111n

		const baseTokenFee = baseTokenAmount * feeBips / (10000n - feeBips)

		// approve the hashflow mock to move quote tokens
		const initialBaseTokenTakerBalance = await getBalance(taker)
		const initialBaseTokenFeeRecipientBalance = await getBalance(feeRecipient)
		const initialBaseTokenTraderBalance = BigInt((await ethers.provider.getBalance(trader.address)).toString())
		const initialBaseTokenPoolBalance = await getBalance(pool)

    const myTrader = await ethers.getContractAt("Trader", trader.address, taker) as Trader;

		const crossChainFee = (await hashflowRouterMock.estimateCrossChainFee()).toBigInt()

		// most of these values are not used in the mock and can be faked
		const tradeTxResponse = await myTrader.tradeXChain({
			srcChainId: '1',
			dstChainId: '2',
			srcPool: pool.address,
			dstPool: ethers.constants.HashZero,
			srcExternalAccount: ethers.constants.AddressZero,
			dstExternalAccount: ethers.constants.HashZero,
			trader: taker.address,
			baseToken: ethers.constants.AddressZero,
			quoteToken: ethers.constants.AddressZero,
			baseTokenAmount,
			quoteTokenAmount,
			quoteExpiry: 0,
			nonce: 0,
			txid: ethers.constants.HashZero,
			signature: "0x00"
		},
		ethers.constants.AddressZero,
		{value: baseTokenAmount + baseTokenFee + crossChainFee}
	)

		const tradeTxReceipt = await tradeTxResponse.wait()

		// move fee tokens to fee recipient
		await trader['sweepNative()']()
	
		const finalBaseTokenTakerBalance = await getBalance(taker)
		const finalBaseTokenFeeRecipientBalance =  await getBalance(feeRecipient)
		const finalBaseTokenTraderBalance = BigInt((await ethers.provider.getBalance(trader.address)).toString())
		const finalBaseTokenPoolBalance =  await getBalance(pool)

		// taker pays base token fee + trade amount + crossChainFee + gas
		expect(initialBaseTokenTakerBalance - finalBaseTokenTakerBalance).toEqual(baseTokenAmount + baseTokenFee + crossChainFee + tradeTxReceipt.gasUsed.toBigInt() * tradeTxReceipt.effectiveGasPrice.toBigInt())

		// pool receives base token amount
		expect(finalBaseTokenPoolBalance - initialBaseTokenPoolBalance).toEqual(baseTokenAmount)

		// fee recipient receives base token fee after sweeping
		expect(finalBaseTokenFeeRecipientBalance - initialBaseTokenFeeRecipientBalance).toEqual(baseTokenFee)
		expect(finalBaseTokenTraderBalance - initialBaseTokenTraderBalance).toEqual(0n)
	})
})
