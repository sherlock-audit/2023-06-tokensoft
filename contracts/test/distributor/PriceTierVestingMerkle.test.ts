import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";
import { ethers } from 'hardhat'
import { GenericERC20, PriceTierVestingMerkle__factory, PriceTierVestingMerkle, ERC20, GenericERC20__factory, FakeChainlinkOracle } from "../../typechain-types";
import { lastBlockTime } from "../lib";

jest.setTimeout(30000);

type PriceTier = {
  price: bigint
  vestedFraction: bigint
}

let deployer: SignerWithAddress
let eligible1: SignerWithAddress
let eligible2: SignerWithAddress
let ineligible: SignerWithAddress
let token: GenericERC20
let btcOracle: FakeChainlinkOracle
let DistributorFactory: PriceTierVestingMerkle__factory
let unvestedDistributor: PriceTierVestingMerkle
let partiallyVestedDistributor: PriceTierVestingMerkle
let fullyVestedDistributor: PriceTierVestingMerkle
let unstartedDistributor: PriceTierVestingMerkle
let endedDistributor: PriceTierVestingMerkle


let unvestedTiers: PriceTier[]
let partiallyVestedTiers: PriceTier[]
let fullyVestedTiers: PriceTier[]

// BTC price of $16820.80/ETH
const btcPrice = 1682080000000n

// start time (in the past)
const startTime = 1n

// end time (in the future)
const endTime = 2672905631n

type Config = {
  total: bigint
  uri: string
  votingFactor: bigint
  proof: {
    merkleRoot: string
    claims: {
      [k: string]: {
        proof: string[],
        data: {
          name: string
          type: string
          value: string
        }[]
      }
    }
  }
}

// distribute a million tokens in total
const config: Config = {
  // 7500 tokens
  total: 7500000000000000000000n,
  // any string will work for these unit tests - the uri is not used on-chain
  uri: 'https://example.com',
  // 2x, denominated in fractionDenominator of 1e4 (basis points)
  votingFactor: 2n * 10n ** 4n,
  // created using yarn generate-merkle-root
  proof: {
    "merkleRoot": "0x7bc676cc9d8db1f8fa03ca95e63b062cc08d8c0bfbdf5a0f18c3b9aadb66555e",
    "claims": {
      "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC": {
        "proof": [
          "0xa82f515a479cbe664b37f89b05d1e13886cae562847741b55442ff8d9df08993"
        ],
        "data": [
          {
            "name": "index",
            "type": "uint256",
            "value": '1'
          },
          {
            "name": "beneficiary",
            "type": "address",
            "value": "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
          },
          {
            "name": "amount",
            "type": "uint256",
            "value": "2500000000000000000000"
          }
        ]
      },
      "0x70997970C51812dc3A010C7d01b50e0d17dc79C8": {
        "proof": [
          "0xc8055cac33ef83d8876a5f8eeb53a54b23b84ef8eeea1cd116d15d78cdf24993"
        ],
        "data": [
          {
            "name": "index",
            "type": "uint256",
            "value": '0'
          },
          {
            "name": "beneficiary",
            "type": "address",
            "value": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
          },
          {
            "name": "amount",
            "type": "uint256",
            "value": "5000000000000000000000"
          }
        ]
      }
    }
  }
}

describe("PriceTierVestingMerkle", function () {
  beforeAll(async () => {
    [deployer, eligible1, eligible2, ineligible] = await ethers.getSigners();

    const GenericERC20Factory = await ethers.getContractFactory("GenericERC20", deployer);
    token = await GenericERC20Factory.deploy(
      "Neue Crypto Token",
      "NCT",
      18,
      // 1B tokens
      (10n ** 9n * 10n ** 18n).toString()
    ) as GenericERC20

    DistributorFactory = await ethers.getContractFactory("PriceTierVestingMerkle", deployer);

    const ChainlinkOracleFactory = await ethers.getContractFactory("FakeChainlinkOracle", deployer);
    btcOracle = await ChainlinkOracleFactory.deploy(
      btcPrice,
      // oracle description
      "BTC/USD"
    ) as FakeChainlinkOracle;

    // get the last block time after a recent transaction to make sure it is recent
    let now = await lastBlockTime();

    unvestedTiers = [
      { price: 2500000000000n, vestedFraction: 1000n },
      { price: 5000000000000n, vestedFraction: 6000n },
      { price: 7500000000000n, vestedFraction: 10000n }
    ]

    partiallyVestedTiers = [
      { price: 1000000000000n, vestedFraction: 1000n },
      { price: 2000000000000n, vestedFraction: 6000n },
      { price: 3000000000000n, vestedFraction: 10000n }
    ]

    fullyVestedTiers = [
      { price: 100000000000n, vestedFraction: 1000n },
      { price: 200000000000n, vestedFraction: 6000n },
      { price: 300000000000n, vestedFraction: 10000n }
    ]

    // no tokens claimable at this price
    unvestedDistributor = await DistributorFactory.deploy(
      token.address,
      config.total,
      config.uri,
      config.votingFactor,
      startTime,
      endTime,
      btcOracle.address,
      unvestedTiers,
      config.proof.merkleRoot
    );

    // some tokens claimable at this price
    partiallyVestedDistributor = await DistributorFactory.deploy(
      token.address,
      config.total,
      config.uri,
      config.votingFactor,
      startTime,
      endTime,
      btcOracle.address,
      partiallyVestedTiers,
      config.proof.merkleRoot
    );

    // all tokens claimable at this price
    fullyVestedDistributor = await DistributorFactory.deploy(
      token.address,
      config.total,
      config.uri,
      config.votingFactor,
      startTime,
      endTime,
      btcOracle.address,
      fullyVestedTiers,
      config.proof.merkleRoot
    );

    // no tokens should be claimable even though price tiers are reached (distribution not started)
    unstartedDistributor = await DistributorFactory.deploy(
      token.address,
      config.total,
      config.uri,
      config.votingFactor,
      startTime,
      endTime,
      btcOracle.address,
      fullyVestedTiers,
      config.proof.merkleRoot
    );

    // all tokens should be claimable even though no price tier is reached (distribution ended)
    endedDistributor = await DistributorFactory.deploy(
      token.address,
      config.total,
      config.uri,
      config.votingFactor,
      startTime,
      endTime,
      btcOracle.address,
      fullyVestedTiers,
      config.proof.merkleRoot
    );

    // transfer tokens to the distributors
    await token.transfer(partiallyVestedDistributor.address, await partiallyVestedDistributor.total())
    await token.transfer(unvestedDistributor.address, await unvestedDistributor.total())
    await token.transfer(fullyVestedDistributor.address, await fullyVestedDistributor.total())
    await token.transfer(unstartedDistributor.address, await unstartedDistributor.total())
    await token.transfer(endedDistributor.address, await endedDistributor.total())
  });

  it("Metadata is correct", async () => {
    const distributor = partiallyVestedDistributor;
    expect(await distributor.NAME()).toEqual("PriceTierVestingMerkle")
    expect(await distributor.VERSION() >= BigNumber.from(1))
    expect(await distributor.uri()).toEqual(config.uri)
  })

  it("Initial distributor configuration is correct", async () => {
    const distributorTiers = [unvestedTiers, partiallyVestedTiers, fullyVestedTiers]

    for (let [i, distributor] of [unvestedDistributor, partiallyVestedDistributor, fullyVestedDistributor].entries()) {
      // the distributor total must match (note the adjustment for rounding error)
      expect((await distributor.total()).toBigInt()).toEqual(config.total)
      // nothing has been claimed
      expect((await distributor.claimed()).toBigInt()).toEqual(0n)

      // check that tiers are correct
      const tiers = await distributor.getPriceTiers()
      expect(tiers.length).toEqual(distributorTiers[i].length)

      for (let [j, tier] of tiers.entries()) {
        expect(tier.price.toBigInt()).toEqual(distributorTiers[i][j].price)
        expect(tier.vestedFraction.toBigInt()).toEqual(distributorTiers[i][j].vestedFraction)
      }

      // no claims have been initialized yet!
      for (let user of [eligible1, eligible2, ineligible]) {
        const distributionRecord = await distributor.getDistributionRecord(user.address)
        // not initialized yet
        expect(distributionRecord.initialized).toEqual(false)
        // the total can be inferred from the sale
        expect(distributionRecord.total.toBigInt()).toEqual(0n)
        // nothing has been claimed yet
        expect(distributionRecord.claimed.toBigInt()).toEqual(0n)
        // TODO: allow voting prior to initialization
        // voting power must be zero prior to initialization
        expect((await distributor.getVotes(user.address)).toBigInt()).toEqual(0n);
        // does not yet hold tokens to claim
        expect((await token.balanceOf(user.address)).toBigInt()).toEqual(0n)
      }

      // fraction denominator is the expected value (10,000)
      expect((await distributor.getFractionDenominator()).toBigInt()).toEqual(10000n)

      // check other config
      expect((await distributor.getStart()).toBigInt()).toEqual(startTime)
      expect((await distributor.getEnd()).toBigInt()).toEqual(endTime)
      expect(await distributor.getOracle()).toEqual(btcOracle.address)
    }
  })

  it("A user can claim without initialization", async () => {
    const user = eligible1
    const distributor = partiallyVestedDistributor

    const [index, beneficiary, amount] = config.proof.claims[user.address].data.map(d => d.value)
    const proof = config.proof.claims[user.address].proof


    await distributor.claim(index, beneficiary, amount, proof)

    // 10% of tokens have already vested
    const claimable = BigInt(amount) / 10n;

    let distributionRecord = await distributor.getDistributionRecord(user.address)

    expect(distributionRecord.total.toBigInt()).toEqual(BigInt(amount))
    expect(distributionRecord.initialized).toEqual(true)
    expect(distributionRecord.claimed.toBigInt()).toEqual(claimable)

    // delegate to self
    const myDistributor = await ethers.getContractAt("PriceTierVestingMerkle", distributor.address, user);
    await myDistributor.delegate(user.address)

    expect((await distributor.getVotes(user.address)).toBigInt()).toEqual(2n * (distributionRecord.total.toBigInt() - distributionRecord.claimed.toBigInt()))
    expect((await token.balanceOf(user.address)).toBigInt()).toEqual(claimable)

    // the distributor metrics are now updated
    expect((await distributor.claimed()).toBigInt()).toEqual(distributionRecord.claimed.toBigInt())
  })

  it("A buyer can initialize before claiming", async () => {
    const user = eligible2
    const distributor = partiallyVestedDistributor
    const [index, beneficiary, amount] = config.proof.claims[user.address].data.map(d => d.value)
    const proof = config.proof.claims[user.address].proof

    // 10% of tokens have already vested
    const claimable = BigInt(amount) / 10n;

    await distributor.initializeDistributionRecord(index, beneficiary, amount, proof)

    let distributionRecord = await distributor.getDistributionRecord(user.address)

    expect(distributionRecord.total.toBigInt()).toEqual(
      BigInt(config.proof.claims[user.address].data[2].value)
    )
    expect(distributionRecord.initialized).toEqual(true)
    expect(distributionRecord.claimed.toBigInt()).toEqual(0n)

    // delegate to self
    const myDistributor = await ethers.getContractAt("PriceTierVestingMerkle", distributor.address, user);
    await myDistributor.delegate(user.address)
    expect((await distributor.getVotes(user.address)).toBigInt()).toEqual(2n * BigInt(amount))

    // the user has no balance
    expect((await token.balanceOf(user.address)).toBigInt(),).toEqual(0n)

    // now we claim!
    await distributor.claim(index, beneficiary, amount, proof)

    distributionRecord = await distributor.getDistributionRecord(user.address)

    expect(distributionRecord.total.toBigInt()).toEqual(
      BigInt(amount)
    )
    expect(distributionRecord.initialized).toEqual(true)
    expect(distributionRecord.claimed.toBigInt()).toEqual(claimable)
    // only unclaimed tokens provide voting power from the distributor
    expect((await distributor.getVotes(user.address)).toBigInt()).toEqual(2n * (distributionRecord.total.toBigInt() - distributionRecord.claimed.toBigInt()))
    // the user now has a balance
    expect((await token.balanceOf(user.address)).toBigInt()).toEqual(claimable)
  })

  it("non-participants in the sale cannot claim any tokens", async () => {
    const user = ineligible
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
    expect((await token.balanceOf(user.address)).toBigInt()).toEqual(0n)

    // The user cannot initialize because they are not in the merkle proof - using another addresses' values will not work
    await expect(
      distributor.initializeDistributionRecord(
        config.proof.claims[eligible1.address].data[0].value, // index
        user.address, // beneficiary
        config.proof.claims[eligible1.address].data[2].value, // amount
        config.proof.claims[eligible1.address].proof, // proof
      )
    ).rejects.toMatchObject({ message: expect.stringMatching(/invalid proof/) })

    // The user cannot claim because they are not in the merkle proof
    await expect(
      distributor.claim(
        config.proof.claims[eligible2.address].data[0].value, // index
        user.address, // beneficiary
        config.proof.claims[eligible2.address].data[2].value, // amount
        config.proof.claims[eligible2.address].proof, // proof
      )
    ).rejects.toMatchObject({ message: expect.stringMatching(/invalid proof/) })
  });

  it("users can claim all tokens when all tiers have vested", async () => {
    const distributor = fullyVestedDistributor

    for (let user of [eligible1, eligible2]) {
      const [index, beneficiary, amount] = config.proof.claims[user.address].data.map(d => d.value)
      const proof = config.proof.claims[user.address].proof

      // get the user's initial token balance
      const initialBalance = (await token.balanceOf(user.address)).toBigInt();
      // claim from the fully vested distributor
      await distributor.claim(index, beneficiary, amount, proof)
      // get the distribution record
      const distributionRecord = await distributor.getDistributionRecord(user.address)
      // get the user's final token balance
      const finalBalance = (await token.balanceOf(user.address)).toBigInt();
      // the total is correct
      expect(distributionRecord.total.toBigInt()).toEqual(
        BigInt(amount)
      )
      // everything has been claimed
      expect(distributionRecord.claimed.toBigInt()).toEqual(
        BigInt(amount)
      )
      // the user's balance has increased by the correct amount
      expect(finalBalance - initialBalance).toEqual(
        BigInt(amount)
      )
      // no votes remaining
      expect((await distributor.getVotes(user.address)).toBigInt()).toEqual(0n)
    }
    // all tokens have been distributed from the fully vested distributor (within rounding error)
    expect((await token.balanceOf(distributor.address)).toNumber()).toBeLessThan(100)
  });

  it("users cannot claim any tokens before the cliff has expired", async () => {
    const distributor = unvestedDistributor

    const total = (await distributor.total()).toBigInt()

    for (let user of [eligible1, eligible2]) {
      const [index, beneficiary, amount] = config.proof.claims[user.address].data.map(d => d.value)
      const proof = config.proof.claims[user.address].proof

      // get the user's initial token balance
      const initialBalance = (await token.balanceOf(user.address)).toBigInt();
      // TODO: why does this fail sometimes (i.e. the tx should revert but does not)
      await expect(
        distributor.claim(index, beneficiary, amount, proof)
      ).rejects.toMatchObject(
        { message: expect.stringMatching(/no more tokens claimable right now/) }
      )
      // get the distribution record
      const distributionRecord = await distributor.getDistributionRecord(user.address)
      // get the user's final token balance
      const finalBalance = (await token.balanceOf(user.address)).toBigInt();
      // the total is correct
      expect(distributionRecord.total.toBigInt()).toEqual(
        0n, // distribution records have not yet been initalized
      )
      // nothing has been claimed
      expect(distributionRecord.claimed.toBigInt()).toEqual(0n)
      // the user's token balance has not increased
      expect(finalBalance - initialBalance).toEqual(0n)
    }
    // no tokens have been distributed from the unvested distributor
    expect((await token.balanceOf(distributor.address)).toBigInt()).toEqual(total)
  });

  it("reverts on misconfiguration during deployment", async () => {
    let now = await lastBlockTime();

    // must vest all tokens
    await expect(DistributorFactory.deploy(
      token.address,
      config.total,
      config.uri,
      config.votingFactor,
      startTime,
      endTime,
      btcOracle.address,
      [
        { price: 1, vestedFraction: 1 },
        { price: 2, vestedFraction: 9999 }
      ],
      config.proof.merkleRoot
    )).rejects.toMatchObject(
      { message: expect.stringMatching(/highest price tier must vest all tokens/) }
    )

    // tranche time must increase
    await expect(DistributorFactory.deploy(
      token.address,
      config.total,
      config.uri,
      config.votingFactor,
      startTime,
      endTime,
      btcOracle.address,
      [
        { price: 1, vestedFraction: 1 },
        { price: 1, vestedFraction: 2 },
        { price: 3, vestedFraction: 10000 }
      ],
      config.proof.merkleRoot
    )).rejects.toMatchObject(
      { message: expect.stringMatching(/tier prices decrease/) }
    )

    // tranche vested fraction must increase
    await expect(DistributorFactory.deploy(
      token.address,
      config.total,
      config.uri,
      config.votingFactor,
      startTime,
      endTime,
      btcOracle.address,
      [
        { price: 1, vestedFraction: 1 },
        { price: 2, vestedFraction: 1 },
        { price: 3, vestedFraction: 10000 }
      ],
      config.proof.merkleRoot
    )).rejects.toMatchObject(
      { message: expect.stringMatching(/vested fraction decreases/) }
    )

    // total cannot be zero
    await expect(
      DistributorFactory.deploy(
        token.address,
        0n,
        config.uri,
        config.votingFactor,
        startTime,
        endTime,
        btcOracle.address,
        partiallyVestedTiers,
        config.proof.merkleRoot
      )
    ).rejects.toMatchObject(
      { message: expect.stringMatching(/Distributor: total is 0/) }
    )
  })

  it.skip("correctly sets price tiers after deployment", async () => {
    const distributor = unvestedDistributor

    const checkSomeTiers = async tiers => {
      for (let i = 0; i < 10; i++) {
        // check for more tiers than we expect
        if (i < newTiers.length) {
          const [time, vestedFraction] = await distributor.getPriceTier(i)
          expect(time.toBigInt()).toEqual(tiers[i].price)
          expect(vestedFraction.toBigInt()).toEqual(tiers[i].vestedFraction)
        } else {
          await expect(
            distributor.getPriceTier(i)
          ).rejects.toMatchObject(
            { message: expect.stringMatching(/reverted with panic code 50/) }
          )
        }
      }
    }

    // set vesting schedule to use a different number of tiers
    let newTiers = [
      {price: 1111n, vestedFraction: 111n},
      {price: 22222222n, vestedFraction: 10000n},
    ]

    await distributor.setPriceTiers(startTime, endTime, btcOracle.address, newTiers);

    await checkSomeTiers(newTiers);

    newTiers = [
      {price: 333n, vestedFraction: 1n},
      {price: 4444n, vestedFraction: 22n},
      {price: 55555n, vestedFraction: 333n},
      {price: 666666n, vestedFraction: 4444n},
      {price: 7777777n, vestedFraction: 5555n},
      {price: 88888888n, vestedFraction: 10000n},
    ]

    await distributor.setPriceTiers(startTime, endTime, btcOracle.address, newTiers)
    await checkSomeTiers(newTiers)
  });
})
