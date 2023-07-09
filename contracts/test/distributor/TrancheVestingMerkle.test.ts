import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";
import { ethers } from 'hardhat'
import { GenericERC20, TrancheVestingMerkle__factory, TrancheVestingMerkle, ERC20, GenericERC20__factory } from "../../typechain-types";
import { lastBlockTime } from "../lib";

jest.setTimeout(30000);

type Tranche = {
  time: bigint
  vestedFraction: bigint
}

let deployer: SignerWithAddress
let eligible1: SignerWithAddress
let eligible2: SignerWithAddress
let ineligible: SignerWithAddress
let token: GenericERC20
let DistributorFactory: TrancheVestingMerkle__factory
let unvestedDistributor: TrancheVestingMerkle
let partiallyVestedDistributor: TrancheVestingMerkle
let fullyVestedDistributor: TrancheVestingMerkle


let unvestedTranches: Tranche[]
let partiallyVestedTranches: Tranche[]
let fullyVestedTranches: Tranche[]

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

describe("TrancheVestingMerkle", function () {
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

    DistributorFactory = await ethers.getContractFactory("TrancheVestingMerkle", deployer);

    // get the last block time after a recent transaction to make sure it is recent
    let now = await lastBlockTime();

    unvestedTranches = [
      {time: now + 100n, vestedFraction: 1000n},
      {time: now + 200n, vestedFraction: 5000n},
      {time: now + 300n, vestedFraction: 10000n},
    ]

    partiallyVestedTranches = [
      {time: now - 100n, vestedFraction: 1000n},
      {time: now - 1n, vestedFraction: 5000n},
      {time: now + 100n, vestedFraction: 10000n},
    ]

    fullyVestedTranches = [
      {time: now - 100n, vestedFraction: 1000n},
      {time: now - 50n, vestedFraction: 5000n},
      {time: now - 10n, vestedFraction: 10000n},
    ]

    // deploy a distributor that has not started vesting (cliff in the future)
    unvestedDistributor = await DistributorFactory.deploy(
      token.address,
      config.total,
      config.uri,
      config.votingFactor,
      unvestedTranches,
      config.proof.merkleRoot
    );

    // deploy another distributor that is mid-vesting
    partiallyVestedDistributor = await DistributorFactory.deploy(
      token.address,
      config.total,
      config.uri,
      config.votingFactor,
      partiallyVestedTranches,
      config.proof.merkleRoot
    );

    fullyVestedDistributor = await DistributorFactory.deploy(
      token.address,
      config.total,
      config.uri,
      config.votingFactor,
      fullyVestedTranches,
      config.proof.merkleRoot
    );

    // transfer tokens to the distributors
    await token.transfer(partiallyVestedDistributor.address, await partiallyVestedDistributor.total())
    await token.transfer(unvestedDistributor.address, await unvestedDistributor.total())
    await token.transfer(fullyVestedDistributor.address, await fullyVestedDistributor.total())
  });

  it("Metadata is correct", async () => {
    const distributor = partiallyVestedDistributor;
    expect(await distributor.NAME()).toEqual("TrancheVestingMerkle")
    expect(await distributor.VERSION() >= BigNumber.from(1))
    expect(await distributor.uri()).toEqual(config.uri)
  })

  it("Initial distributor configuration is correct", async () => {
    const distributorTranches = [unvestedTranches, partiallyVestedTranches, fullyVestedTranches]
  
    for (let [i, distributor] of [unvestedDistributor, partiallyVestedDistributor, fullyVestedDistributor].entries()) {
      // the distributor total must match (note the adjustment for rounding error)
      expect((await distributor.total()).toBigInt()).toEqual(config.total)
      // nothing has been claimed
      expect((await distributor.claimed()).toBigInt()).toEqual(0n)

      const tranches = await distributor.getTranches()

      expect(tranches.length).toEqual(distributorTranches[i].length)

      for (let [j, tranche] of tranches.entries()) {
        expect(tranche.time.toBigInt()).toEqual(distributorTranches[i][j].time)
        expect(tranche.vestedFraction.toBigInt()).toEqual(distributorTranches[i][j].vestedFraction)
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
    }
  })

  it("A user can claim without initialization", async () => {
    const user = eligible1
    const distributor = partiallyVestedDistributor

    const [index, beneficiary, amount] = config.proof.claims[user.address].data.map(d => d.value)
    const proof = config.proof.claims[user.address].proof


    await distributor.claim(index, beneficiary, amount, proof)

    // 50% of tokens have already vested
    const claimable = BigInt(amount) / 2n;

    let distributionRecord = await distributor.getDistributionRecord(user.address)

    expect(distributionRecord.total.toBigInt()).toEqual(BigInt(amount))
    expect(distributionRecord.initialized).toEqual(true)
    expect(distributionRecord.claimed.toBigInt()).toEqual(claimable)

    // delegate to self
    expect((await distributor.getVotes(user.address)).toBigInt()).toEqual(0n)
    const myDistributor = await ethers.getContractAt("TrancheVestingMerkle", distributor.address, user);
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

    // 50% of tokens have already vested
    const claimable = BigInt(amount) / 2n;
    
    await distributor.initializeDistributionRecord(index, beneficiary, amount, proof)

    let distributionRecord = await distributor.getDistributionRecord(user.address)

    expect(distributionRecord.total.toBigInt()).toEqual(
      BigInt(config.proof.claims[user.address].data[2].value)
    )
    // no votes prior to delegation
    expect((await distributor.getVotes(user.address)).toBigInt()).toEqual(0n)

    // delegate to self
    const myDistributor = await ethers.getContractAt("TrancheVestingMerkle", distributor.address, user);
    await myDistributor.delegate(user.address)

    expect(distributionRecord.total.toBigInt()).toEqual(
      BigInt(config.proof.claims[user.address].data[2].value)
    )

    expect(distributionRecord.initialized).toEqual(true)
    expect(distributionRecord.claimed.toBigInt()).toEqual(0n)
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

  it("users can claim all tokens when all tranches have vested", async () => {
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
      [
        {time: 1, vestedFraction: 1},
        {time: 2, vestedFraction: 9999}
      ],
      config.proof.merkleRoot
    )).rejects.toMatchObject(
      {message: expect.stringMatching(/last tranche must vest all tokens/)}
    )

    // tranche time must increase
    await expect(DistributorFactory.deploy(
      token.address,
      config.total,
      config.uri,
      config.votingFactor,
      [
        {time: 1, vestedFraction: 1},
        {time: 1, vestedFraction: 2},
        {time: 3, vestedFraction: 10000}
      ],
      config.proof.merkleRoot
    )).rejects.toMatchObject(
      {message: expect.stringMatching(/tranche time must increase/)}
    )

    // tranche vested fraction must increase
    await expect(DistributorFactory.deploy(
      token.address,
      config.total,
      config.uri,
      config.votingFactor,
      [
        {time: 1, vestedFraction: 1},
        {time: 2, vestedFraction: 1},
        {time: 3, vestedFraction: 10000}
      ],
      config.proof.merkleRoot
    )).rejects.toMatchObject(
      {message: expect.stringMatching(/tranche vested fraction must increase/)}
    )

    // total cannot be zero
    await expect(
      DistributorFactory.deploy(
        token.address,
        0n,
        config.uri,
        config.votingFactor,
        partiallyVestedTranches,
        config.proof.merkleRoot
      )
    ).rejects.toMatchObject(
      { message: expect.stringMatching(/Distributor: total is 0/) }
    )

    // cannot accidentally use tranches with times in milliseconds past the epoch
    await expect(DistributorFactory.deploy(
      token.address,
      config.total,
      config.uri,
      config.votingFactor,
      [
        // oops - time in milliseconds
        {time: new Date().getTime(), vestedFraction: 10000}
      ],
      config.proof.merkleRoot
    )).rejects.toMatchObject(
      {message: expect.stringMatching(/vesting ends after 4102444800/)}
    )
  })

  // TODO: why is this causing the node to stop entirely?
  it.skip("correctly sets tranches after deployment", async () => {
    const distributor = unvestedDistributor

    const checkSomeTranches = async tranches => {
      for (let i = 0; i < 10; i++) {
        // check for more tranches than we expect
        if (i < newTranches.length) {
          const [time, vestedFraction] = await distributor.getTranche(i)
          expect(time.toBigInt()).toEqual(tranches[i].time)
          expect(vestedFraction.toBigInt()).toEqual(tranches[i].vestedFraction)
        } else {
          await expect(
            distributor.getTranche(i)
          ).rejects.toMatchObject(
            { message: expect.stringMatching(/reverted with panic code 50/) }
          )
        }
      }
    }

    // set vesting schedule to use a different number of tranches
    let newTranches = [
      {time: 1n, vestedFraction: 111n},
      {time: 2n, vestedFraction: 10000n},
    ]

    await distributor.setTranches(newTranches);

    await checkSomeTranches(newTranches);

    newTranches = [
      {time: 3n, vestedFraction: 1n},
      {time: 4n, vestedFraction: 22n},
      {time: 5n, vestedFraction: 333n},
      {time: 6n, vestedFraction: 4444n},
      {time: 7n, vestedFraction: 5555n},
      {time: 8n, vestedFraction: 10000n},
    ]

    await distributor.setTranches(newTranches)
    await checkSomeTranches(newTranches)
  });

})
