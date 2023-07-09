import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";
import { ethers } from 'hardhat'
import { TrancheVestingSale_1_3, SaleManager_v_1_3, GenericERC20, FakeChainlinkOracle, TrancheVestingSale_1_3__factory } from "../../typechain-types";
import { delay, expectCloseEnough, getSaleId, lastBlockTime } from "../lib";

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
let DistributorFactory: TrancheVestingSale_1_3__factory
let unvestedDistributor: TrancheVestingSale_1_3
let partiallyVestedDistributor: TrancheVestingSale_1_3
let fullyVestedDistributor: TrancheVestingSale_1_3
let publicSaleId: string
let usdc: GenericERC20
let newToken: GenericERC20
let chainlinkOracle: FakeChainlinkOracle
let saleManager: SaleManager_v_1_3;

// $100
const usdcPaymentAmount = 100000000n;
// $2.9424
const ethPaymentAmount = ethers.utils.parseEther("0.001").toBigInt()
// eth price of $2942.40
const ethPrice = 294240000000n
const nctPrice = 1500000n // $1.50 USDC / NCT
const votingFactorBips = 15000n; // 1.5x
const uri = "https://example.com"


describe("TrancheVestingSale_1_3", function () {
  beforeAll(async () => {
    [deployer, admin, recipient, buyer0, buyer1, buyer2, buyer3, nonBuyer] = await ethers.getSigners();

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

    // a chainlink oracle for ETH/USD
    const ChainlinkOracle = await ethers.getContractFactory("FakeChainlinkOracle", deployer);
    chainlinkOracle = await ChainlinkOracle.deploy(
      ethPrice,
      // oracle description
      "ETH/USD"
    ) as FakeChainlinkOracle

    // a token to claim
    newToken = await GenericERC20Factory.deploy(
      "Neue Crypto Token",
      "NCT",
      18,
      // 1B tokens
      // (10n ** 9n * 10n ** 18n).toString()
      '1000000000000000000000000000'
    ) as GenericERC20

    // create a sale
    const SaleManagerFactory = await ethers.getContractFactory("SaleManager_v_1_3", admin);
    saleManager = await SaleManagerFactory.deploy(
      usdc.address,
      6,
      chainlinkOracle.address
    ) as SaleManager_v_1_3

    // a public sale
    const publicSaleTx = await saleManager.newSale(
      recipient.address,
      "0x0000000000000000000000000000000000000000000000000000000000000000", // public sale
      20000000000, // 20k USDC sale limit
      10000000000, // 10k USDC user limit
      1000000, // 1 USDC purchase minimum
      Math.floor(Math.random() * 10 ** 5), // starts at random value so that we can keep launching new sales w/o getting the duplicate sale warning
      ((await lastBlockTime()) + 1000n).toString(), // sale ends in 1000 seconds
      0, // max queue time
      "ipfs://QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq/2",
      nctPrice.toString(),
      18 // NCT has 18 decimals
    );

    publicSaleId = await getSaleId(publicSaleTx)

    for (let signer of buyers) {
      const mySaleManager = await ethers.getContractAt("SaleManager_v_1_3", saleManager.address, signer);
      const myUSDC = await ethers.getContractAt("GenericERC20", usdc.address, signer);

      await myUSDC.approve(
        mySaleManager.address,
        usdcPaymentAmount
      );

      // buy with USDC
      await mySaleManager.functions['buy(bytes32,uint256,bytes32[])'](
        publicSaleId,
        usdcPaymentAmount,
        // no merkle proof
        []
      );

      // buy with ETH
      await mySaleManager.functions["buy(bytes32,bytes32[])"](
        publicSaleId,
        // no merkle proof
        [],
        {
          value: ethPaymentAmount
        }
      );
    }

    // set the end time barely in the future
    const endTime = await lastBlockTime() + 4n

    await saleManager.setEnd(publicSaleId, endTime);

    if (await lastBlockTime() < endTime) {
      // delay a bit more
      await delay(4000);
    }

    // deploy a distributor that is done vesting all tranches
    DistributorFactory = await ethers.getContractFactory("TrancheVestingSale_1_3", deployer);

    // deploy another distributor with a distribution schedule that is in the past
    partiallyVestedDistributor = await DistributorFactory.deploy(
      saleManager.address,
      publicSaleId,
      newToken.address,
      [
        // 10% of tokens vested a very long time ago
        { time: 1, vestedFraction: 1000 },
        // 50% of tokens have already vested
        { time: 1665188605, vestedFraction: 5000 },
        // 50% of tokens vest in the future
        { time: 2664826464, vestedFraction: 10000 }
      ],
      // a 1.5x voting factor
      15000,
      uri
    );

    // register at least one of the distributors as a courtesy to the subgraph
    await saleManager.registerClaimManager(publicSaleId, partiallyVestedDistributor.address)

    fullyVestedDistributor = await DistributorFactory.deploy(
      saleManager.address,
      publicSaleId,
      newToken.address,
      [
        // 10% of tokens vest at each time
        { time: 1, vestedFraction: 1000 },
        { time: 2, vestedFraction: 2000 },
        { time: 3, vestedFraction: 3000 },
        { time: 4, vestedFraction: 4000 },
        { time: 5, vestedFraction: 5000 },
        { time: 6, vestedFraction: 6000 },
        { time: 7, vestedFraction: 7000 },
        { time: 8, vestedFraction: 8000 },
        { time: 9, vestedFraction: 9000 },
        { time: 10, vestedFraction: 10000 }
      ],
      // a 1.5x voting factor
      15000,
      uri
    );

    unvestedDistributor = await DistributorFactory.deploy(
      saleManager.address,
      publicSaleId,
      newToken.address,
      [
        // no tokens have vested  yet
        { time: 4000000000, vestedFraction: 10000 }
      ],
      // a 1.5x voting factor
      15000,
      uri
    );

    // transfer tokens to the distributors (we are testing 3 distributors, in practice a sale would use one!)
    await newToken.transfer(partiallyVestedDistributor.address, await partiallyVestedDistributor.total())
    await newToken.transfer(unvestedDistributor.address, await unvestedDistributor.total())
    await newToken.transfer(fullyVestedDistributor.address, await fullyVestedDistributor.total())
  });

  it("Metadata is correct", async () => {
    const distributor = partiallyVestedDistributor;
    expect(await distributor.NAME()).toEqual("TrancheVestingSale_1_3")
    expect(await distributor.VERSION() >= BigNumber.from(1))
    expect(await distributor.uri()).toEqual(uri)
  })

  it("Initial setup matches sale correctly", async () => {
    const distributor = partiallyVestedDistributor;
    expect(await distributor.saleManager()).toEqual(saleManager.address)
    expect(await distributor.saleId()).toEqual(publicSaleId)
    expect(await distributor.token()).toEqual(newToken.address)

    // verify the sale is storing the data we expect
    // each buyer spent $2.9424 of ETH and $100 of USDC each: this is 100000000 + 2942400 = 102942400 USDC each
    // (the v1.3 sale records purchases denominated in the payment token)
    const totalSpent = (await saleManager.getTotalSpent(publicSaleId)).toBigInt()
    expect(totalSpent).toEqual(BigInt(buyers.length) * 102942400n);

    // each bought token cost $1.50 and has 18 decimals instead of 6
    const totalBought = (await saleManager.spentToBought(publicSaleId, totalSpent)).toBigInt()
    expect(totalBought).toEqual(totalSpent * 10n ** 18n / nctPrice);

    // convert from $102.9424 of 6 decimal USDC to 18 decimal NCT at a price of $1.50 per NCT) (or zero for non-buyers)
    const boughtTokens = (signer) => buyers.includes(signer)
      ? 102942400n * 10n ** 18n / nctPrice
      : 0n

    for (let user of [deployer, buyer0, buyer1, buyer2, buyer3, nonBuyer]) {
      // verify that the claim manager returns the correct purchased amount for each user (some are buyers, some are not)
      expect((await distributor.getPurchasedAmount(user.address)).toBigInt()).toEqual(boughtTokens(user))
    }

    // the distributor total must match
    expect((await distributor.total()).toBigInt()).toEqual(totalBought)
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
  
    // delegate to self
    const myDistributor = await ethers.getContractAt("TrancheVestingSale_1_3", distributor.address, buyer);
    await myDistributor.delegate(buyer.address)

    // only one tranche has elapsed
    expect(distributionRecord.claimed.toBigInt()).toEqual(currentlyClaimable)

    // voting power has decreased after claim
    expectCloseEnough(
      (await distributor.getVotes(buyer.address)).toBigInt(),
      currentlyClaimable * votingFactorBips / 10000n,
      1n
    )

    // buyer now holds tokens
    expect((await newToken.balanceOf(buyer.address)).toBigInt()).toEqual(currentlyClaimable)

    // the user cannot claim again for now
    await expect(
      distributor.claim(buyer.address)
    ).rejects.toMatchObject(
      { message: expect.stringMatching(/no more tokens claimable right now/) }
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

    await distributor.initializeDistributionRecord(buyer.address)
    const distributionRecord = await distributor.getDistributionRecord(buyer.address)
    expect(distributionRecord.total.toBigInt()).toEqual(buyerTotal)
    expect(distributionRecord.initialized).toEqual(true)

    // delegate to self
    const myDistributor = await ethers.getContractAt("TrancheVestingSale_1_3", distributor.address, buyer);
    await myDistributor.delegate(buyer.address)

    // nothing has been claimed yet
    expect(distributionRecord.claimed.toBigInt()).toEqual(0n)
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

    await distributor.initializeDistributionRecord(buyer.address)
    let distributionRecord = await distributor.getDistributionRecord(buyer.address)
    expect(distributionRecord.total.toBigInt()).toEqual(buyerTotal)
    expect(distributionRecord.initialized).toEqual(true)

    // delegate to self
    const myDistributor = await ethers.getContractAt("TrancheVestingSale_1_3", distributor.address, buyer);
    await myDistributor.delegate(buyer.address)

    // nothing has been claimed yet
    expect(distributionRecord.claimed.toBigInt()).toEqual(0n)
    // voting power available after initialization
    expect((await distributor.getVotes(buyer.address)).toBigInt()).toEqual(buyerTotal * votingFactorBips / 10000n)

    await distributor.claim(buyer.address)
    distributionRecord = await distributor.getDistributionRecord(buyer.address)

    expect(distributionRecord.claimed.toBigInt()).toEqual(currentlyClaimable)
    // voting power has decreased
    expectCloseEnough(
      (await distributor.getVotes(buyer.address)).toBigInt(),
      currentlyClaimable * votingFactorBips / 10000n,
      1n
    )


    // buyer now holds tokens
    expect((await newToken.balanceOf(buyer.address)).toBigInt()).toEqual(currentlyClaimable)

    // the user cannot claim again for now
    await expect(
      distributor.claim(buyer.address)
    ).rejects.toMatchObject(
      { message: expect.stringMatching(/no more tokens claimable right now/) }
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
    ).rejects.toMatchObject({ message: expect.stringMatching(/no purchases found/) })

    // The user cannot claim because they did not make any purchases
    await expect(
      distributor.claim(user.address)
    ).rejects.toMatchObject({ message: expect.stringMatching(/no purchases found/) })
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
        { message: expect.stringMatching(/no more tokens claimable right now/) }
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

  // TODO: cannot set up invalid distributor tranches
  it.skip("reverts on misconfiguration during deployment", async () => {
    // Cannot distribute a token with the wrong number of decimals
    await expect(
      DistributorFactory.deploy(
        saleManager.address,
        publicSaleId,
        // this is the wrong token - it has 6 decimals instead of the required 18
        usdc.address,
        [
          { time: 1, vestedFraction: 5000 },
          { time: 2664826464, vestedFraction: 10000 }
        ],
        15000,
        uri
      )
    ).rejects.toMatchObject(
      { message: expect.stringMatching(/token decimals do not match sale/) }
    )

    // Cannot set the sale to an invalid address
    await expect(
      DistributorFactory.deploy(
        // this is not a valid sale address
        deployer.address,
        publicSaleId,
        newToken.address,
        [
          { time: 1, vestedFraction: 5000 },
          { time: 2664826464, vestedFraction: 10000 }
        ],
        15000,
        uri
      )
    ).rejects.toMatchObject(
      { message: expect.stringMatching(/Transaction reverted: function returned an unexpected amount of data/) }
    )

    // Cannot deploy with an invalid sale id
    await expect(
      DistributorFactory.deploy(
        saleManager.address,
        // a random invalid sale id
        '0xb1a5bda84b83f7f014abcf0cf69cab5a4de1c3ececa8123a5e4aaacb01f63f83',
        newToken.address,
        [
          { time: 1, vestedFraction: 5000 },
          { time: 2664826464, vestedFraction: 10000 }
        ],
        15000,
        uri
      )
    ).rejects.toMatchObject(
      { message: expect.stringMatching(/invalid sale id/) }
    )

    // Must vest all tokens
    await expect(
      DistributorFactory.deploy(
        saleManager.address,
        publicSaleId,
        newToken.address,
        [
          { time: 1, vestedFraction: 5000 },
          // this is not quite all tokens!
          { time: 2664826464, vestedFraction: 9999 }
        ],
        15000,
        uri
      )
    ).rejects.toMatchObject(
      { message: expect.stringMatching(/last tranche must vest all tokens/) }
    )

    // Tranche times must increase
    await expect(
      DistributorFactory.deploy(
        saleManager.address,
        publicSaleId,
        newToken.address,
        [
          { time: 1000, vestedFraction: 5000 },
          // going backward in time -- oops
          { time: 999, vestedFraction: 10000 }
        ],
        15000,
        uri
      )
    ).rejects.toMatchObject(
      { message: expect.stringMatching(/tranche time must increase/) }
    )

    // Tranche vested fraction must increase
    await expect(
      DistributorFactory.deploy(
        saleManager.address,
        publicSaleId,
        newToken.address,
        [
          { time: 1, vestedFraction: 10000 },
          // vested fraction is decreasing -- oops
          { time: 2, vestedFraction: 5000 }
        ],
        15000,
        uri
      )
    ).rejects.toMatchObject(
      { message: expect.stringMatching(/tranche vested fraction must increase/) }
    )
  });

  it('can only be deployed when the sale is closed', async () => {
    // a public sale that is still open
    const openPublicSaleTx = await saleManager.newSale(
      recipient.address,
      "0x0000000000000000000000000000000000000000000000000000000000000000", // public sale
      20000000000,
      10000000000,
      1000000,
      Math.floor(Math.random() * 10 ** 5),
      ((await lastBlockTime()) + 1000n).toString(),
      0,
      "ipfs://QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq/2",
      nctPrice.toString(),
      18
    );

    const openPublicSaleId = await getSaleId(openPublicSaleTx)

    // make a purchase
    const mySaleManager = await ethers.getContractAt("SaleManager_v_1_3", saleManager.address, buyer0);

    // buy with ETH
    await mySaleManager.functions["buy(bytes32,bytes32[])"](
      openPublicSaleId,
      // no merkle proof
      [],
      {
        value: ethPaymentAmount
      }
    );

    await expect(DistributorFactory.deploy(
      saleManager.address,
      openPublicSaleId,
      newToken.address,
      [
        { time: 1, vestedFraction: 5000 },
        { time: 2, vestedFraction: 10000 }
      ],
      15000,
      uri
    )
    ).rejects.toMatchObject(
      { message: expect.stringMatching(/TVS_1_3_D: sale not over/) }
    )
  });

  it('total to distribute must be > 0', async () => {
    // a public sale that is still open
    const openPublicSaleTx = await saleManager.newSale(
      recipient.address,
      "0x0000000000000000000000000000000000000000000000000000000000000000", // public sale
      20000000000,
      10000000000,
      1000000,
      Math.floor(Math.random() * 10 ** 5),
      ((await lastBlockTime()) + 1000n).toString(),
      0,
      "ipfs://QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq/2",
      nctPrice.toString(),
      18
    );

    const openPublicSaleId = await getSaleId(openPublicSaleTx)

    await expect(DistributorFactory.deploy(
      saleManager.address,
      openPublicSaleId,
      newToken.address,
      [
        { time: 1, vestedFraction: 5000 },
        { time: 2, vestedFraction: 10000 }
      ],
      15000,
      uri
    )
    ).rejects.toMatchObject(
      { message: expect.stringMatching(/Distributor: total is 0/) }
    )
  });
});
