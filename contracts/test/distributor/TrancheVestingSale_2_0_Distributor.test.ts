import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";
import { ethers } from 'hardhat'
import { GenericERC20, FakeChainlinkOracle, TrancheVestingSale_2_0__factory, TrancheVestingSale_2_0, FlatPriceSale, FlatPriceSaleFactory } from "../../typechain-types";
import { delay, lastBlockTime, getSaleAddress_2_0, makeMonthlyTranches, expectCloseEnough } from "../lib";
import {merkleRoots, campaignCIDs} from '../../config'
import {buildIpfsUri} from '../../utils'
import { ConfigStruct } from "../../typechain-types/contracts/sale/v2/FlatPriceSale";

jest.setTimeout(30000);

let deployer: SignerWithAddress
let admin: SignerWithAddress
let recipient: SignerWithAddress
let buyer0: SignerWithAddress
let buyer1: SignerWithAddress
let buyer2: SignerWithAddress
let buyer3: SignerWithAddress
let buyers: SignerWithAddress[]
let nonBuyer: SignerWithAddress
let feeRecipient: SignerWithAddress
let config: ConfigStruct
let DistributorFactory: TrancheVestingSale_2_0__factory
let unvestedDistributor: TrancheVestingSale_2_0
let partiallyVestedDistributor: TrancheVestingSale_2_0
let fullyVestedDistributor: TrancheVestingSale_2_0
let publicSaleId: string
let usdc: GenericERC20
let newToken: GenericERC20
let ethOracle: FakeChainlinkOracle
let usdcOracle: FakeChainlinkOracle
let saleImplementation: FlatPriceSale;
let sale: FlatPriceSale;
let saleFactory: FlatPriceSaleFactory;

// $100 (6 decimals)
const usdcPaymentAmount = 100000000n;
// $2.9424 (18 decimals)
const ethPaymentAmount = ethers.utils.parseEther("0.001").toBigInt()
// eth price of $2942.40/ETH
const ethPrice = 294240000000n
// usdc price of $1.001/USDC (8 decimals)
const usdcPrice = 101000000n
 // $1.50 / NCT (8 decimals)
const nctPrice = 150000000n
const votingFactorBips = 15000n; // 1.5x
const uri = "https://example.com"

describe("TrancheVestingSale_2_0", function () {
  beforeAll(async () => {
    [deployer, admin, recipient, buyer0, buyer1, buyer2, buyer3, nonBuyer, feeRecipient ] = await ethers.getSigners();

    // make a couple purchases as various users.
    buyers = [buyer0, buyer1, buyer2, buyer3]
  
    // a payment token (USDC)
    const GenericERC20Factory = await ethers.getContractFactory("GenericERC20", deployer);
    usdc = await GenericERC20Factory.deploy(
      "US Dollar Coin",
      "USDC",
      6,
      "1000000000000000"
    ) as GenericERC20;

    // transfer tokens to buyers
    for (let signer of buyers) {
      await usdc.transfer(signer.address, usdcPaymentAmount)
    }

    const ChainlinkOracleFactory = await ethers.getContractFactory("FakeChainlinkOracle", deployer);

    // a chainlink oracle for ETH/USD
    ethOracle = await ChainlinkOracleFactory.deploy(
      ethPrice,
      // oracle description
      "ETH/USD"
    ) as FakeChainlinkOracle;

    // a chainlink oracle for USDC/USD
    usdcOracle = await ChainlinkOracleFactory.deploy(
      usdcPrice,
      // oracle description
      "ETH/USD"
    ) as FakeChainlinkOracle;

    // a token to claim
    newToken = await GenericERC20Factory.deploy(
      "Neue Crypto Token",
      "NCT",
      18,
      // 1B tokens
      // (10n ** 9n * 10n ** 18n).toString()
      '1000000000000000000000000000'
    ) as GenericERC20;

    // create an implementation contract
    const SaleImplementationFactory = await ethers.getContractFactory("FlatPriceSale", admin);
  
    saleImplementation = await SaleImplementationFactory.deploy(
      // fee bips
      250,
      // fee recipient
      feeRecipient.address
    ) as FlatPriceSale;

    // create a sale
    const SaleFactoryFactory = await ethers.getContractFactory("FlatPriceSaleFactory", admin);

    saleFactory = await SaleFactoryFactory.deploy(
      saleImplementation.address
    ) as FlatPriceSaleFactory;

    config = {
      // recipient of sale proceeds
      recipient: recipient.address,
      // merkle root
      merkleRoot: merkleRoots.public,
      // merkleRoots.public,
      // sale maximum ($1,000,000) - note the 8 decimal precision!
      saleMaximum: 1e6 * 1e8,
      // user maximum ($1,000)
      userMaximum: 1e3 * 1e8,
      // purchase minimum ($1)
      purchaseMinimum: 1 * 1e8,
      // start time (current seconds past epoch) - 10000 seconds ago
      startTime: Math.floor(new Date().getTime() / 1000) - 10000,
      // end time (10 days from now)
      endTime: Math.floor(new Date(new Date().getTime() + 10 * 24 * 3600 * 1000).getTime() / 1000),
      // max queue time 1 hour
      maxQueueTime: 0,
      URI: buildIpfsUri(campaignCIDs.basicSale)
    }

    const publicSaleTx = await saleFactory.newSale(
      deployer.address,
      config,
      // base currency
      'USD',
      // native payments enabled
      true,
      // native price oracle
      ethOracle.address,
      // payment tokens
      [usdc.address],
      // payment token price oracles
      [usdcOracle.address],
      // payment token decimals
      [6]
    )

    const address = await getSaleAddress_2_0(publicSaleTx);

    sale = await ethers.getContractAt("FlatPriceSale", address, deployer);

    for (let buyer of buyers) {
      const mySale = await ethers.getContractAt("FlatPriceSale", sale.address, buyer);
      const myUSDC = await ethers.getContractAt("GenericERC20", usdc.address, buyer);
  
      await myUSDC.approve(
        mySale.address,
        usdcPaymentAmount
      );
  
      // buy with USDC
      await mySale.buyWithToken(
        usdc.address,
        usdcPaymentAmount,
        // no data
        '0x',
        // no merkle proof
        []
      );
  
      // buy with ETH
      await mySale.buyWithNative(
        // no data
        '0x',
        // no merkle proof
        [],
        {
          value: ethPaymentAmount
        }
      );
    }

    // find an end time barely in the future
    const endTime = await lastBlockTime() + 4n

    // change the sale end time
    await sale.update({
      ...config, endTime
    });

    if (await lastBlockTime() < endTime) {
      // delay a bit more
      await delay(4000);
    }

    // deploy a distributor that is done vesting all tranches
    DistributorFactory = await ethers.getContractFactory("TrancheVestingSale_2_0", deployer);

    // deploy another distributor with a distribution schedule that is in the past
    partiallyVestedDistributor = await DistributorFactory.deploy(
      sale.address,
      newToken.address,
      await newToken.decimals(),
      nctPrice,
      [
        // 10% of tokens vested a very long time ago
        {time: 1, vestedFraction: 1000},
        // 50% of tokens have already vested
        {time: 1665188605, vestedFraction: 5000},
        // 50% of tokens vest in the future
        {time: 2664826464, vestedFraction: 10000}
      ],
      // a 1.5x voting factor
      15000,
      uri
    );
    
    fullyVestedDistributor = await DistributorFactory.deploy(
      sale.address,
      newToken.address,
      await newToken.decimals(),
      nctPrice,
      [
        // 10% of tokens vest at each time
        {time: 1, vestedFraction: 1000},
        {time: 2, vestedFraction: 2000},
        {time: 3, vestedFraction: 3000},
        {time: 4, vestedFraction: 4000},
        {time: 5, vestedFraction: 5000},
        {time: 6, vestedFraction: 6000},
        {time: 7, vestedFraction: 7000},
        {time: 8, vestedFraction: 8000},
        {time: 9, vestedFraction: 9000},
        {time: 10, vestedFraction: 10000}
      ],
      // a 1.5x voting factor
      15000,
      uri
    );

    unvestedDistributor = await DistributorFactory.deploy(
      sale.address,
      newToken.address,
      await newToken.decimals(),
      nctPrice,
      [
        // no tokens have vested  yet
        {time: 4000000000, vestedFraction: 10000}
      ],
      // a 1.5x voting factor
      15000,
      uri
    );
  
    // transfer tokens to the distributors (we are testing 3 distributors, in practice a sale would use one!)
    await newToken.transfer(partiallyVestedDistributor.address, await partiallyVestedDistributor.total())
    await newToken.transfer(unvestedDistributor.address, await unvestedDistributor.total())
    await newToken.transfer(fullyVestedDistributor.address, await fullyVestedDistributor.total())
    
    // register at least one of the distributors as a test
    await sale.registerDistributor(partiallyVestedDistributor.address)
  });

  it("Metadata is correct", async () => {
    const distributor = partiallyVestedDistributor;
    expect(await distributor.NAME()).toEqual("TrancheVestingSale_2_0")
    expect(await distributor.VERSION() >= BigNumber.from(1))
    expect(await distributor.uri()).toEqual(uri)
  })

  it("Initial setup matches sale correctly", async () => {
    const distributor = partiallyVestedDistributor;
    expect(await distributor.sale()).toEqual(sale.address)
    expect((await distributor.price()).toBigInt()).toEqual(nctPrice)
    expect(await distributor.decimals()).toEqual(await newToken.decimals())
    expect(await distributor.token()).toEqual(newToken.address)

    // each buyer spent $2.9424 of ETH and $101 of USDC each: this is 100000000 + 2942400 = $102.9424 USD each (8 decimals)
    const spentPerBuyer =  10394240000n

    // verify the sale is storing the data we expect
    // (the v2.0 sale records purchases denominated with 8 decimals)
    const totalSpent = (await sale.total()).toBigInt()
    expect(totalSpent).toEqual(BigInt(buyers.length) * spentPerBuyer);
    // verify the sale has the right spent value for a user
    expect((await sale.buyerTotal(buyer0.address)).toBigInt()).toEqual(spentPerBuyer)

    // convert from $103.9424 of USD (8 decimals) to NCT (18 decimals) at a price of $1.50 per NCT (8 decimals)
    const boughtPerBuyer = spentPerBuyer * 10n ** 18n / nctPrice

    // the distributor itself doesn't care what was spent - it only cares what was bought
    const boughtTokens = (signer) => buyers.includes(signer)
      // participated in the sale
      ? boughtPerBuyer
      // did not participate in the sale
      : 0n
  
    // verify that the claim manager returns the correct purchased amount for each user (some are buyers, some are not)
    for (let user of [deployer, buyer0, buyer1, buyer2, buyer3, nonBuyer]) {
      expect((await distributor.getPurchasedAmount(user.address)).toBigInt()).toEqual(boughtTokens(user))
    }
  
    // the distributor total must match (note the adjustment for rounding error)
    expect((await distributor.total()).toBigInt()).toEqual(BigInt(buyers.length) * boughtPerBuyer + 1n)
    // nothing has been claimed
    expect((await distributor.claimed()).toBigInt()).toEqual(0n)

    // how many tokens should each buyer receive?
    const buyerTotal = (await distributor.total()).toBigInt() / BigInt(buyers.length)

    // no claims have been initialized yet!
    for (let buyer of buyers) {
      const distributionRecord = await distributor.getDistributionRecord(buyer.address)
      // not initialized yet
      expect(distributionRecord.initialized).toEqual(false)
      // the total can be inferred from the sale
      expect(distributionRecord.total.toBigInt()).toEqual(buyerTotal)
      // nothing has been claimed yet
      expect(distributionRecord.claimed.toBigInt()).toEqual(0n)
      // TODO: allow voting prior to initialization
      // voting power must be zero prior to initialization
      expect((await distributor.getVotes(buyer.address)).toBigInt()).toEqual(0n);
      // does not yet hold tokens to claim
      expect((await newToken.balanceOf(buyer.address)).toBigInt()).toEqual(0n)
    }
  })

  it("A buyer can claim without initialization", async () => {
    const buyer = buyer0
    const distributor = partiallyVestedDistributor
    const buyerTotal = (await distributor.total()).toBigInt() / BigInt(buyers.length)

    // only half of the tokens are claimable right now
    const currentlyClaimable = buyerTotal / 2n;
  
    await distributor.claim(buyer.address)
    let distributionRecord = await distributor.getDistributionRecord(buyer.address)
    // only half of the tokens are claimable right now
    expect(distributionRecord.total.toBigInt()).toEqual(buyerTotal)
    expect(distributionRecord.initialized).toEqual(true)

    // only one tranche has elapsed
    expect(distributionRecord.claimed.toBigInt()).toEqual(currentlyClaimable)

    // delegate to self
    const myDistributor = await ethers.getContractAt("ContinuousVestingMerkle", distributor.address, buyer);
    await myDistributor.delegate(buyer.address)
  
    // voting power has decreased after claim (within rounding error)
    expectCloseEnough(
      (await distributor.getVotes(buyer.address)).toBigInt(),
      (buyerTotal - currentlyClaimable) * votingFactorBips / 10000n,
      1n
    )

    // buyer now holds tokens
    expect((await newToken.balanceOf(buyer.address)).toBigInt()).toEqual(currentlyClaimable)

    // the user cannot claim again for now
    await expect(
      distributor.claim(buyer.address)
    ).rejects.toMatchObject(
      {message: expect.stringMatching(/no more tokens claimable right now/)}
    )
    // internal accounting hasn't changed
    distributionRecord = await distributor.getDistributionRecord(buyer.address)
    expect(distributionRecord.claimed.toBigInt()).toEqual(currentlyClaimable)
    // token balance hasn't changed
    expect((await newToken.balanceOf(buyer.address)).toBigInt()).toEqual(currentlyClaimable)
  })

  it("A buyer can initialize without claiming", async () => {
    const buyer = buyer1
    const distributor = partiallyVestedDistributor

    const buyerTotal = (await distributor.total()).toBigInt() / BigInt(buyers.length)
    const currentlyClaimable = buyerTotal / 2n;

    // getClaimableAmount() works prior to initialization
    expect((await distributor.getClaimableAmount(buyer.address)).toBigInt()).toEqual(currentlyClaimable)
  
    await distributor.initializeDistributionRecord(buyer.address)
    const distributionRecord = await distributor.getDistributionRecord(buyer.address)
    expect(distributionRecord.total.toBigInt()).toEqual(buyerTotal)
    expect(distributionRecord.initialized).toEqual(true)

    // getClaimableAmount() works after initialization
    expect((await distributor.getClaimableAmount(buyer.address)).toBigInt()).toEqual(currentlyClaimable)

    // nothing has been claimed yet
    expect(distributionRecord.claimed.toBigInt()).toEqual(0n)

    // delegate to self
    const myDistributor = await ethers.getContractAt("ContinuousVestingMerkle", distributor.address, buyer);
    await myDistributor.delegate(buyer.address)

    // voting power available after initialization
    expect((await distributor.getVotes(buyer.address)).toBigInt()).toEqual(buyerTotal * votingFactorBips / 10000n)

    // buyer has not claimed tokens
    expect((await newToken.balanceOf(buyer.address)).toBigInt()).toEqual(0n)
  })

  it("A buyer can initialize and then claim", async () => {
    const buyer = buyer2
    const distributor = partiallyVestedDistributor

    const buyerTotal = (await distributor.total()).toBigInt() / BigInt(buyers.length)
    // only half of the tokens are claimable right now
    const currentlyClaimable = buyerTotal / 2n;

    // getClaimableAmount() works prior to initialization
    expect((await distributor.getClaimableAmount(buyer.address)).toBigInt()).toEqual(currentlyClaimable)
  
    await distributor.initializeDistributionRecord(buyer.address)
    let distributionRecord = await distributor.getDistributionRecord(buyer.address)
    expect(distributionRecord.total.toBigInt()).toEqual(buyerTotal)
    expect(distributionRecord.initialized).toEqual(true)

    // nothing has been claimed yet
    expect(distributionRecord.claimed.toBigInt()).toEqual(0n)

    // delegate to self
    const myDistributor = await ethers.getContractAt("ContinuousVestingMerkle", distributor.address, buyer);
    await myDistributor.delegate(buyer.address)
        
    // voting power available after initialization
    expect((await distributor.getVotes(buyer.address)).toBigInt()).toEqual(buyerTotal * votingFactorBips / 10000n)

    await distributor.claim(buyer.address)
    distributionRecord = await distributor.getDistributionRecord(buyer.address)

    expect(distributionRecord.claimed.toBigInt()).toEqual(currentlyClaimable)
    // voting power has decreased (note the adjustment for rounding error)
    expect((await distributor.getVotes(buyer.address)).toBigInt()).toEqual(currentlyClaimable * votingFactorBips / 10000n + 1n)

    // buyer now holds tokens
    expect((await newToken.balanceOf(buyer.address)).toBigInt()).toEqual(currentlyClaimable)

    // the user cannot claim again for now
    await expect(
      distributor.claim(buyer.address)
    ).rejects.toMatchObject(
      {message: expect.stringMatching(/no more tokens claimable right now/)}
    )
    // internal accounting hasn't changed
    distributionRecord = await distributor.getDistributionRecord(buyer.address)
    expect(distributionRecord.claimed.toBigInt()).toEqual(currentlyClaimable)
    // token balance hasn't changed
    expect((await newToken.balanceOf(buyer.address)).toBigInt()).toEqual(currentlyClaimable)
  })

  it("non-participants in the sale cannot claim any tokens", async () => {
    const user = nonBuyer
    const distributor = partiallyVestedDistributor
  
    let distributionRecord = await distributor.getDistributionRecord(user.address)
    // nothing to distribute
    expect(distributionRecord.total.toBigInt()).toEqual(0n)
    // nothing claimed
    expect(distributionRecord.claimed.toBigInt()).toEqual(0n)
    // no votes
    expect((await distributor.getVotes(user.address)).toBigInt()).toEqual(0n)
    // not initialized
    expect(distributionRecord.initialized).toEqual(false)
    // user holds no tokens
    expect((await newToken.balanceOf(user.address)).toBigInt()).toEqual(0n)

    // The user cannot initialize because they did not make any purchases
    await expect(
      distributor.initializeDistributionRecord(user.address)
    ).rejects.toMatchObject({message: expect.stringMatching(/no purchases found/)})

    // The user cannot claim because they did not make any purchases
    await expect(
      distributor.claim(user.address)
    ).rejects.toMatchObject({message: expect.stringMatching(/no purchases found/)})
  });

  it("IMPORTANT: buyers can claim all tokens when all tranches have vested", async () => {
    const distributor = fullyVestedDistributor
  
    const total = (await distributor.total()).toBigInt()
    const userTotal = total / BigInt(buyers.length)

    for (let user of buyers) {
      // get the user's initial token balance
      const initialBalance = (await newToken.balanceOf(user.address)).toBigInt();
      // claim from the fully veseted distributor
      await distributor.claim(user.address);
      // get the distribution record
      const distributionRecord = await distributor.getDistributionRecord(user.address)
      // get the user's final token balance
      const finalBalance = (await newToken.balanceOf(user.address)).toBigInt();
      // the total is correct
      expect(distributionRecord.total.toBigInt()).toEqual(userTotal)
      // everything has been claimed
      expect(distributionRecord.claimed.toBigInt()).toEqual(userTotal)
      // the user's balance has increased by the correct amount
      expect(finalBalance - initialBalance).toEqual(userTotal)
      // no votes remaining
      expect((await distributor.getVotes(user.address)).toBigInt()).toEqual(0n)
    }
    // all tokens have been distributed from the fully vested distributor (within rounding error)
    expect((await newToken.balanceOf(distributor.address)).toBigInt()).toBeLessThan(10n)
  });

  it("buyers cannot claim any tokens when no tranches have completed", async () => {
    const distributor = unvestedDistributor

    const total = (await distributor.total()).toBigInt()
    const userTotal = total / BigInt(buyers.length)

    for (let user of buyers) {
      // get the user's initial token balance
      const initialBalance = (await newToken.balanceOf(user.address)).toBigInt();
      await expect(
        distributor.claim(user.address)
      ).rejects.toMatchObject(
        {message: expect.stringMatching(/no more tokens claimable right now/)}
      )
      // get the distribution record
      const distributionRecord = await distributor.getDistributionRecord(user.address)
      // get the user's final token balance
      const finalBalance = (await newToken.balanceOf(user.address)).toBigInt();
      // the total is correct
      expect(distributionRecord.total.toBigInt()).toEqual(userTotal)
      // nothing has been claimed
      expect(distributionRecord.claimed.toBigInt()).toEqual(0n)
      // the user's token balance has not increased
      expect(finalBalance - initialBalance).toEqual(0n)
    }
    // no tokens have been distributed from the unvested distributor
    expect((await newToken.balanceOf(distributor.address)).toBigInt()).toEqual(total)
  });

  // TODO: why does error message not match?
  it.skip("reverts on misconfiguration during deployment", async () => {
    // Cannot set the sale to an invalid address
    await expect(
      DistributorFactory.deploy(
        deployer.address,
        newToken.address,
        await newToken.decimals(),
        nctPrice,
        [
          // no tokens have vested  yet
          {time: 4000000000, vestedFraction: 10000}
        ],
        // a 1.5x voting factor
        15000,
        uri
      )
    ).rejects.toMatchObject(
      {message: expect.stringMatching(/Transaction reverted: function returned an unexpected amount of data/)}
    )

    // Must vest all tokens
    await expect(
      DistributorFactory.deploy(
        sale.address,
        newToken.address,
        await newToken.decimals(),
        nctPrice,
        [
          {time: 1, vestedFraction: 5000},
          // this is not quite all tokens!
          {time: 2664826464, vestedFraction: 9999}
        ],
        // a 1.5x voting factor
        15000,
        uri
      )
    ).rejects.toMatchObject(
      {message: expect.stringMatching(/last tranche must vest all tokens/)}
    )

    // Tranche times must increase
    await expect(
      DistributorFactory.deploy(
        sale.address,
        newToken.address,
        await newToken.decimals(),
        nctPrice,
        [
          {time: 1000, vestedFraction: 5000},
          // going backward in time -- oops
          {time: 999, vestedFraction: 10000}
        ],
        // a 1.5x voting factor
        15000,
        uri
      )
    ).rejects.toMatchObject(
      {message: expect.stringMatching(/tranche time must increase/)}
    )

    // Tranche vested fraction must increase
    await expect(
      DistributorFactory.deploy(
        sale.address,
        newToken.address,
        await newToken.decimals(),
        nctPrice,
        [
          {time: 1, vestedFraction: 10000},
          // vested fraction is decreasing -- oops
          {time: 2, vestedFraction: 5000}
        ],
        // a 1.5x voting factor
        15000,
        uri
      )
    ).rejects.toMatchObject(
      {message: expect.stringMatching(/tranche vested fraction must increase/)}
    )
  });

  it('can only be deployed when the sale is closed', async () => {
    const openPublicSaleTx = await saleFactory.newSale(
      deployer.address,
      config,
      // base currency
      'USD',
      // native payments enabled
      true,
      // native price oracle
      ethOracle.address,
      // payment tokens
      [usdc.address],
      // payment token price oracles
      [usdcOracle.address],
      // payment token decimals
      [6]
    )
    
    const openSaleAddress = await getSaleAddress_2_0(openPublicSaleTx)
    const openSale = await ethers.getContractAt("FlatPriceSale", openSaleAddress, deployer);

    // make a purchase
    const mySale = await ethers.getContractAt("FlatPriceSale", openSale.address, buyer0);

    // buy with ETH
    await mySale.buyWithNative(
      // no data
      '0x',
      // no merkle proof
      [],
      {
        value: ethPaymentAmount
      }
    );

    await expect(
      DistributorFactory.deploy(
        openSale.address,
        newToken.address,
        await newToken.decimals(),
        nctPrice,
        [
          // 10% of tokens vest at each time
          {time: 1, vestedFraction: 10000}
        ],
        // a 1.5x voting factor
        15000,
        uri
      )
    ).rejects.toMatchObject(
      {message: expect.stringMatching(/TVS_2_0_D: sale not over/)}
    )
  });

  it('total to distribute must be > 0', async () => {
    const openPublicSaleTx = await saleFactory.newSale(
      deployer.address,
      config,
      // base currency
      'USD',
      // native payments enabled
      true,
      // native price oracle
      ethOracle.address,
      // payment tokens
      [usdc.address],
      // payment token price oracles
      [usdcOracle.address],
      // payment token decimals
      [6]
    )

    const openSaleAddress = await getSaleAddress_2_0(openPublicSaleTx)

    await expect(
      DistributorFactory.deploy(
        openSaleAddress,
        newToken.address,
        await newToken.decimals(),
        nctPrice,
        [
          // 10% of tokens vest at each time
          {time: 1, vestedFraction: 10000}
        ],
        // a 1.5x voting factor
        15000,
        uri
      )
    ).rejects.toMatchObject(
      {message: expect.stringMatching(/Distributor: total is 0/)}
    )
  })
});
