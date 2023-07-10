import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";
import { ethers } from 'hardhat'
import { GenericERC20, ContinuousVestingMerkle__factory, ContinuousVestingMerkle } from "../../typechain-types";
import { delay, lastBlockTime, expectCloseEnough } from "../lib";
import { merkleRoots, campaignCIDs } from '../../config'
import { buildIpfsUri } from '../../utils'

jest.setTimeout(30000);

let deployer: SignerWithAddress // 0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266
let eligible1: SignerWithAddress // 0x70997970c51812dc3a010c7d01b50e0d17dc79c8
let eligible2: SignerWithAddress // 0x90F79bf6EB2c4f870365E785982E1f101E93b906
let ineligible: SignerWithAddress // 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
let token: GenericERC20
let DistributorFactory: ContinuousVestingMerkle__factory
let unvestedDistributor: ContinuousVestingMerkle
let partiallyVestedDistributor: ContinuousVestingMerkle
let fullyVestedDistributor: ContinuousVestingMerkle
let unvestedTimes: [bigint, bigint, bigint]
let partiallyVestedTimes: [bigint, bigint, bigint]
let fullyVestedTimes: [bigint, bigint, bigint]

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
  // 1 million tokens
  total: 7500000000000000000000n,
  // any string will work for these unit tests - the uri is not used on-chain
  uri: 'https://example.com',
  // 2x, denominated in fractionDenominator of 1e18
  votingFactor: 2n * 10n ** 18n,
  // created using yarn generate-merkle-root
  proof: {
    "merkleRoot": "0x7bc676cc9d8db1f8fa03ca95e63b062cc08d8c0bfbdf5a0f18c3b9aadb66555e",
    "claims": {
      // eligible1
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
      },
      // eligible2
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
    }
  }
}

const estimateClaimableTokens = (now: bigint, start: bigint, cliff: bigint, end: bigint, total: bigint) => {
  if (now < start || now < cliff) {
    return 0n
  }

  if (now > end) {
    return total
  }

  return total * (now - start) / (end - start)
}

describe("ContinuousVestingMerkle", function () {
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

    DistributorFactory = await ethers.getContractFactory("ContinuousVestingMerkle", deployer);

    // get the last block time after a recent transaction to make sure it is recent
    let now = await lastBlockTime();

    unvestedTimes = [
      now - 10000n, // start time 10000 seconds ago
      now + 10000n, // cliff in 10000 seconds,
      now + 20000n,  // vesting ends in 20000 seconds
    ]

    partiallyVestedTimes = [
      now - 5000n, // start time 5000 seconds ago
      now - 5000n, // cliff 5000 seconds ago
      now + 5000n,  // vesting ends in 500 seconds
    ]

    fullyVestedTimes = [
      now - 100n, // start: 100 seconds ago
      now - 50n, // cliff: 50 seconds ago
      now,  // end: now
    ]

    // deploy a distributor that has not started vesting (cliff in the future)
    unvestedDistributor = await DistributorFactory.deploy(
      token.address,
      config.total,
      config.uri,
      config.votingFactor,
      ...unvestedTimes,
      config.proof.merkleRoot
    );

    // deploy another distributor that is mid-vesting
    partiallyVestedDistributor = await DistributorFactory.deploy(
      token.address,
      config.total,
      config.uri,
      config.votingFactor,
      ...partiallyVestedTimes,
      config.proof.merkleRoot
    );

    fullyVestedDistributor = await DistributorFactory.deploy(
      token.address,
      config.total,
      config.uri,
      config.votingFactor,
      ...fullyVestedTimes,
      config.proof.merkleRoot
    );

    // transfer tokens to the distributors
    await token.transfer(partiallyVestedDistributor.address, await partiallyVestedDistributor.total())
    await token.transfer(unvestedDistributor.address, await unvestedDistributor.total())
    await token.transfer(fullyVestedDistributor.address, await fullyVestedDistributor.total())

    console.log('***', {
      eligible1: eligible1.address,
      eligible2: eligible2.address,
      ineligible: ineligible.address
    })
    
  });

  it("Metadata is correct", async () => {
    const distributor = partiallyVestedDistributor;
    expect(await distributor.NAME()).toEqual("ContinuousVestingMerkle")
    expect(await distributor.VERSION() >= BigNumber.from(1))
    expect(await distributor.uri()).toEqual(config.uri)
  })

  it("Initial distributor configuration is correct", async () => {
    const distributorTimes = [unvestedTimes, partiallyVestedTimes, fullyVestedTimes]

    for (let [i, distributor] of [unvestedDistributor, partiallyVestedDistributor, fullyVestedDistributor].entries()) {
      // the distributor total must match (note the adjustment for rounding error)
      expect((await distributor.total()).toBigInt()).toEqual(config.total)
      // nothing has been claimed
      expect((await distributor.claimed()).toBigInt()).toEqual(0n)

      const [start, cliff, end] = (await distributor.getVestingConfig()).map(v => v.toBigInt())

      // distributor remembers vesting times correctly
      expect(start).toEqual(distributorTimes[i][0])
      expect(cliff).toEqual(distributorTimes[i][1])
      expect(end).toEqual(distributorTimes[i][2])

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

      // fraction denominator is the expected value (1e18)
      expect((await distributor.getFractionDenominator()).toBigInt()).toEqual(10n ** 18n)
    }
  })

  it("A user can claim without initialization", async () => {
    const user = eligible1
    const distributor = partiallyVestedDistributor

    const [index, beneficiary, amount] = config.proof.claims[user.address].data.map(d => d.value)
    const proof = config.proof.claims[user.address].proof


    await distributor.claim(index, beneficiary, amount, proof)

    let estimatedClaimable = estimateClaimableTokens(
      await lastBlockTime(),
      ...partiallyVestedTimes,
      BigInt(config.proof.claims[user.address].data[2].value)
    )

    let distributionRecord = await distributor.getDistributionRecord(user.address)

    expect(distributionRecord.total.toBigInt()).toEqual(
      BigInt(config.proof.claims[user.address].data[2].value)
    )
    expect(distributionRecord.initialized).toEqual(true)

    expectCloseEnough(
      distributionRecord.claimed.toBigInt(),
      estimatedClaimable,
      BigInt(amount) / 100n
    )

    // about half of the tokens should be claimable (within ~1%)
    expectCloseEnough(
      distributionRecord.claimed.toBigInt(),
      BigInt(amount) / 2n,
      BigInt(amount) / 100n
    )

    expect((await distributor.getVotes(user.address)).toBigInt()).toEqual(0n)

    // delegate to self
    const myDistributor = await ethers.getContractAt("ContinuousVestingMerkle", distributor.address, user);
    await myDistributor.delegate(user.address)

    // voting power is present once delegation occurs (within 1%)
    expectCloseEnough(
      (await distributor.getVotes(user.address)).toBigInt(),
      // a factor of two is applied to all unclaimed tokens for voting power
      2n * (distributionRecord.total.toBigInt() - distributionRecord.claimed.toBigInt()),
      BigInt(amount) / 100n
    )

    // the user now has a balance
    expectCloseEnough(
      (await token.balanceOf(user.address)).toBigInt(),
      estimatedClaimable,
      config.total / 100n
    )

    // the distributor metrics are now updated
    expect((await distributor.claimed()).toBigInt()).toEqual(distributionRecord.claimed.toBigInt())
  })

  it("A buyer can initialize and delegate before claiming", async () => {
    const user = eligible2
    const distributor = partiallyVestedDistributor
    const [index, beneficiary, amount] = config.proof.claims[user.address].data.map(d => d.value)
    const proof = config.proof.claims[user.address].proof


    await distributor.initializeDistributionRecord(index, beneficiary, amount, proof)

    let distributionRecord = await distributor.getDistributionRecord(user.address)

    expect(distributionRecord.total.toBigInt()).toEqual(
      BigInt(config.proof.claims[user.address].data[2].value)
    )
    expect(distributionRecord.initialized).toEqual(true)
    expect(distributionRecord.claimed.toBigInt()).toEqual(0n)
    expect((await distributor.getVotes(user.address)).toBigInt()).toEqual(0n)

    // delegate to self
    const myDistributor = await ethers.getContractAt("ContinuousVestingMerkle", distributor.address, user);
    await myDistributor.delegate(user.address)

    // the user has no balance
    expect((await token.balanceOf(user.address)).toBigInt(),).toEqual(0n)

    // now we claim!
    await distributor.claim(index, beneficiary, amount, proof)
    const estimatedClaimable = estimateClaimableTokens(await lastBlockTime(), ...partiallyVestedTimes, BigInt(amount))

    distributionRecord = await distributor.getDistributionRecord(user.address)

    expect(distributionRecord.total.toBigInt()).toEqual(
      BigInt(amount)
    )
    expect(distributionRecord.initialized).toEqual(true)

    expectCloseEnough(
      distributionRecord.claimed.toBigInt(),
      estimatedClaimable,
      BigInt(amount) / 100n
    )

    // about one half of the tokens should be claimable
    expectCloseEnough(
      distributionRecord.claimed.toBigInt(),
      BigInt(amount) / 2n,
      BigInt(amount) / 100n
    )

    // voting power is present once a claim occurs (within ~1%)
    expectCloseEnough(
      (await distributor.getVotes(user.address)).toBigInt(),
      // a factor of two is applied to all unclaimed tokens for voting power
      2n * (distributionRecord.total.toBigInt() - distributionRecord.claimed.toBigInt()),
      BigInt(amount) / 100n
    )

    // the user now has a balance
    expectCloseEnough(
      (await token.balanceOf(user.address)).toBigInt(),
      estimatedClaimable,
      BigInt(amount) / 100n
    )
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
    expectCloseEnough(
      (await token.balanceOf(distributor.address)).toBigInt(),
      0n,
      100n
    )
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

    // cliff before start
    await expect(
      DistributorFactory.deploy(
        token.address,
        config.total,
        config.uri,
        config.votingFactor,
        now - 10n, // start time 10 seconds ago
        now - 20n, // cliff 20 seconds ago (before start time)
        now,  // vesting ends now
        config.proof.merkleRoot
      )
    ).rejects.toMatchObject(
      { message: expect.stringMatching(/vesting cliff before start/) }
    )

    // cliff after end
    await expect(
      DistributorFactory.deploy(
        token.address,
        config.total,
        config.uri,
        config.votingFactor,
        now - 10n, // start time 10 seconds ago
        now + 20n, // cliff 20 seconds ago (before start time)
        now,  // vesting ends now
        config.proof.merkleRoot
      )
    ).rejects.toMatchObject(
      { message: expect.stringMatching(/vesting end before cliff/) }
    )
  });

  it('total to distribute must be > 0', async () => {
    let now = await lastBlockTime();

    await expect(
      DistributorFactory.deploy(
        token.address,
        0n,
        config.uri,
        config.votingFactor,
        now - 10n, // start time 10 seconds ago
        now + 20n, // cliff 20 seconds ago (before start time)
        now,  // vesting ends now
        config.proof.merkleRoot
      )
    ).rejects.toMatchObject(
      { message: expect.stringMatching(/Distributor: total is 0/) }
    )
  })

  it('handles merkle root updates correctly', async () => {
    // this proof changes the quantities and users
    const updatedProof = {
      "merkleRoot": "0x4c72e97f572f234e76b91e5e39a208e173ebbef3a1bbcf5ca94d64761f93f9e3",
      "claims": {
        "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC": {
          "proof": [
            "0x121a74816d03cf7942c071502d1ece53f8bf75a6ee9554e1f779b258c877e81f",
            "0xcff0df6405186fe42f73033b28f6260ee83c87773db200d830665a2d7170b991"
          ],
          "data": [
            {
              "name": "index",
              "type": "uint256",
              "value": 1
            },
            {
              "name": "beneficiary",
              "type": "address",
              "value": "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"
            },
            {
              "name": "amount",
              "type": "uint256",
              "value": "1100000000000000000000"
            }
          ]
        },
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8": {
          "proof": [
            "0xfecd7570efdf9df5431ac8e438c299dc873f52efb3aab9b87ebb319136d2e6b0"
          ],
          "data": [
            {
              "name": "index",
              "type": "uint256",
              "value": 0
            },
            {
              "name": "beneficiary",
              "type": "address",
              "value": "0x70997970C51812dc3A010C7d01b50e0d17dc79C8"
            },
            {
              "name": "amount",
              "type": "uint256",
              "value": "0"
            }
          ]
        },
        "0x90F79bf6EB2c4f870365E785982E1f101E93b906": {
          "proof": [
            "0x75bd8c270b22209bc2da8dd4c303f03871e248fa0d5a140ffa952ded018e2be7",
            "0xcff0df6405186fe42f73033b28f6260ee83c87773db200d830665a2d7170b991"
          ],
          "data": [
            {
              "name": "index",
              "type": "uint256",
              "value": 0
            },
            {
              "name": "beneficiary",
              "type": "address",
              "value": "0x90F79bf6EB2c4f870365E785982E1f101E93b906"
            },
            {
              "name": "amount",
              "type": "uint256",
              "value": "6600000000000000000000"
            }
          ]
        }
      }
    }
    const updatedTotal = 7700000000000000000000n

    // avoid silly mistakes
    expect(eligible1.address).toEqual('0x70997970C51812dc3A010C7d01b50e0d17dc79C8')
    expect(eligible2.address).toEqual('0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC')
    expect(ineligible.address).toEqual('0x90F79bf6EB2c4f870365E785982E1f101E93b906')

    let now = await lastBlockTime();

    // deploy a distributor with the default config that is mid-distribution
    const distributor = await DistributorFactory.deploy(
      token.address,
      config.total,
      config.uri,
      config.votingFactor,
      ...partiallyVestedTimes,
      config.proof.merkleRoot
    );

    // get some tokens to the distributor
    await token.transfer(distributor.address, config.total)
    /**
     * Sanity check: distributions still work before the merkle root update
     */

    // eligible1 can claim
    let user = eligible1
    let [index, beneficiary, amount] = config.proof.claims[user.address].data.map(d => d.value)
    let proof = config.proof.claims[user.address].proof

    let estimatedClaimable = estimateClaimableTokens(
      await lastBlockTime(),
      ...partiallyVestedTimes,
      BigInt(config.proof.claims[user.address].data[2].value)
    )

    await distributor.claim(index, beneficiary, amount, proof)

    let distributionRecord = await distributor.getDistributionRecord(user.address)
    const eligible1Claimed = distributionRecord.claimed.toBigInt()

    expect(distributionRecord.total.toBigInt()).toEqual(
      BigInt(config.proof.claims[user.address].data[2].value)
    )
    expect(distributionRecord.initialized).toEqual(true)

    expectCloseEnough(
      distributionRecord.claimed.toBigInt(),
      estimatedClaimable,
      BigInt(amount) / 100n
    )

    // about half of the tokens should be claimable (within ~1%)
    expectCloseEnough(
      distributionRecord.claimed.toBigInt(),
      BigInt(amount) / 2n,
      BigInt(amount) / 100n
    )
    
    // eligible2 can initialize distribution record (but not claim)
    user = eligible2;

    [index, beneficiary, amount] = config.proof.claims[user.address].data.map(d => d.value)
    proof = config.proof.claims[user.address].proof

    await distributor.initializeDistributionRecord(index, beneficiary, amount, proof)

    distributionRecord = await distributor.getDistributionRecord(user.address)

    expect(distributionRecord.total.toBigInt()).toEqual(
      BigInt(config.proof.claims[user.address].data[2].value)
    )
    expect(distributionRecord.initialized).toEqual(true)
    expect(distributionRecord.claimed.toBigInt()).toEqual(0n)

    // ineligible cannot claim or initialize distribution record (the new proof has not been applied)
    user = ineligible;
    [index, beneficiary, amount] = updatedProof.claims[user.address].data.map(d => d.value)
    proof = updatedProof.claims[user.address].proof

    await expect(
      distributor.initializeDistributionRecord(
        index, beneficiary, amount, proof)
    ).rejects.toMatchObject({ message: expect.stringMatching(/invalid proof/) })

    await expect(
      distributor.claim(
        index, beneficiary, amount, proof)
    ).rejects.toMatchObject({ message: expect.stringMatching(/invalid proof/) })

    /**
     * Update the Merkle Root and Total
     */

    // update the merkle root
    await distributor.setMerkleRoot(updatedProof.merkleRoot)

    // verify the root has been updated
    expect(await distributor.getMerkleRoot()).toEqual(updatedProof.merkleRoot)

    // the total is still incorrect
    expect((await distributor.total()).toBigInt()).toEqual(config.total)

    // update the total
    await distributor.setTotal(updatedTotal)

    // now it is correct
    expect((await distributor.total()).toBigInt()).toEqual(updatedTotal)

    // move more tokens to the contract since total claimable quantity has increased
    await token.transfer(distributor.address, updatedTotal - config.total)

    /**
     * Claims now work with the updated merkle root
     */

    // eligible1 can no longer claim
    user = eligible1;
    [index, beneficiary, amount] = config.proof.claims[user.address].data.map(d => d.value)
    proof = config.proof.claims[user.address].proof

    await expect(
      distributor.claim(
        index, beneficiary, amount, proof)
    ).rejects.toMatchObject({ message: expect.stringMatching(/invalid proof/) })

    // eligible1 distribution record still incorrectly shows a total
    distributionRecord = await distributor.getDistributionRecord(user.address)

    expect(distributionRecord.total.toBigInt()).toEqual(
      BigInt(config.proof.claims[user.address].data[2].value)
    )
    expect(distributionRecord.initialized).toEqual(true);

    // can re-initialize this distribution record with the correct details
    [index, beneficiary, amount] = updatedProof.claims[user.address].data.map(d => d.value)
    proof = updatedProof.claims[user.address].proof
    await distributor.initializeDistributionRecord(index, beneficiary, amount, proof)

    distributionRecord = await distributor.getDistributionRecord(user.address)

    expect(distributionRecord.total.toBigInt()).toEqual(0n)
    expect(distributionRecord.initialized).toEqual(true)

    // the previously claimed value is preserved
    expect(distributionRecord.claimed.toBigInt()).toEqual(eligible1Claimed)

    // eligible2 can claim using the total from the updated distribution record
    user = eligible2;

    [index, beneficiary, amount] = updatedProof.claims[user.address].data.map(d => d.value)
    proof = updatedProof.claims[user.address].proof
  
    await distributor.claim(index, beneficiary, amount, proof)

    estimatedClaimable = estimateClaimableTokens(
      await lastBlockTime(),
      ...partiallyVestedTimes,
      BigInt(updatedProof.claims[user.address].data[2].value)
    )

    // the distribution record has been updated and matches new values
    distributionRecord = await distributor.getDistributionRecord(user.address)

    expect(distributionRecord.total.toBigInt()).toEqual(
      BigInt(updatedProof.claims[user.address].data[2].value)
    )
    expect(distributionRecord.initialized).toEqual(true)

    expectCloseEnough(
      distributionRecord.claimed.toBigInt(),
      estimatedClaimable,
      BigInt(amount) / 100n
    )

    // ineligible can now claim
    user = ineligible;
    [index, beneficiary, amount] = updatedProof.claims[user.address].data.map(d => d.value)
    proof = updatedProof.claims[user.address].proof

    await distributor.claim(index, beneficiary, amount, proof)

    estimatedClaimable = estimateClaimableTokens(
      await lastBlockTime(),
      ...partiallyVestedTimes,
      BigInt(updatedProof.claims[user.address].data[2].value)
    )

    distributionRecord = await distributor.getDistributionRecord(user.address)

    expect(distributionRecord.total.toBigInt()).toEqual(
      BigInt(updatedProof.claims[user.address].data[2].value)
    )
    expect(distributionRecord.initialized).toEqual(true)

    expectCloseEnough(
      distributionRecord.claimed.toBigInt(),
      estimatedClaimable,
      BigInt(amount) / 100n
    )
  })
})
