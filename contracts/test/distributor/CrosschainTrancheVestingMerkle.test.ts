import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";
import hre from 'hardhat'
import { GenericERC20, CrosschainTrancheVestingMerkle__factory, CrosschainTrancheVestingMerkle, ERC20, GenericERC20__factory, IConnext, Satellite__factory, Satellite, ConnextMock__factory, ConnextMock } from "../../typechain-types";
import SatelliteDefinition from '../../artifacts/contracts/claim/Satellite.sol/Satellite.json'
import { time } from "@nomicfoundation/hardhat-network-helpers";
import exp from "constants";

const ethers = (hre as any).ethers

jest.setTimeout(30000);

type Tranche = {
  time: bigint
  vestedFraction: bigint
}

let deployer: SignerWithAddress
let eligible1: SignerWithAddress
let eligible2: SignerWithAddress
let eligible3: SignerWithAddress
let ineligible: SignerWithAddress
let token: GenericERC20
let otherToken: GenericERC20
let DistributorFactory: CrosschainTrancheVestingMerkle__factory
let ConnextFactory: ConnextMock__factory
let connextMockSource: ConnextMock
let connextMockDestination: ConnextMock
let SatelliteFactory: Satellite__factory
let distributor: CrosschainTrancheVestingMerkle
let distributorWithQueue: CrosschainTrancheVestingMerkle
let satellite: Satellite

let tranches: Tranche[]

// largest possible delay for the distributor using a fair queue
const maxDelayTime = 1000n

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
    "merkleRoot": "0xc1778e1119d42ffb00f014fe412946116e02f73b32e324022cedb5256b5b95cd",
    "claims": {
      "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc": {
        "proof": [
          "0x6718c87625cce6cc64ebea422c01216633da3330fe7c9098da88b4734f8bc2a8",
          "0xb8cb8af04efd13b603589588a13c9e63474c4d79452a944db4e9c7d2d2c7ec2f"
        ],
        "data": [
          {
            "name": "beneficiary",
            "type": "address",
            "value": "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc"
          },
          {
            "name": "amount",
            "type": "uint256",
            "value": "1000"
          },
          {
            "name": "domain",
            "type": "uint32",
            "value": "1735353714"
          }
        ]
      },
      "0x70997970c51812dc3a010c7d01b50e0d17dc79c8": {
        "proof": [
          "0x76b9712b2409dcb4449bd096a2902b87b13c43a5072e2da15920338790e7972d"
        ],
        "data": [
          {
            "name": "beneficiary",
            "type": "address",
            "value": "0x70997970c51812dc3a010c7d01b50e0d17dc79c8"
          },
          {
            "name": "amount",
            "type": "uint256",
            "value": "1000"
          },
          {
            "name": "domain",
            "type": "uint32",
            "value": "1735353714"
          }
        ]
      },
      "0x90f79bf6eb2c4f870365e785982e1f101e93b906": {
        "proof": [
          "0x73df9df38ba48b812d2bad1c95fa3ba5390bdc5c3aec13e4c598a893c8af4811",
          "0xb8cb8af04efd13b603589588a13c9e63474c4d79452a944db4e9c7d2d2c7ec2f"
        ],
        "data": [
          {
            "name": "beneficiary",
            "type": "address",
            "value": "0x90f79bf6eb2c4f870365e785982e1f101e93b906"
          },
          {
            "name": "amount",
            "type": "uint256",
            "value": "1000"
          },
          {
            "name": "domain",
            "type": "uint32",
            "value": "2"
          }
        ]
      }
    }
  }
}

describe("CrosschainTrancheVestingMerkle", function () {
  beforeAll(async () => {
    // kick off a transaction to update the block time
    let now = BigInt(await time.latest()) + 10000n;
    await time.increaseTo(now);

    [deployer, eligible1, eligible2, eligible3, ineligible] = await ethers.getSigners();

    const GenericERC20Factory = await ethers.getContractFactory("GenericERC20", deployer);
    token = await GenericERC20Factory.deploy(
      "Neue Crypto Token",
      "NCT",
      18,
      // 1B tokens
      (10n ** 9n * 10n ** 18n).toString()
    ) as GenericERC20

    otherToken = await GenericERC20Factory.deploy(
      "Other Neue Crypto Token",
      "ONCT",
      18,
      // 1B tokens
      (10n ** 9n * 10n ** 18n).toString()
    ) as GenericERC20

    ConnextFactory = await ethers.getContractFactory("ConnextMock", deployer);
    connextMockSource = await ConnextFactory.deploy(
      1735353714 // source domain
    );
    connextMockDestination = await ConnextFactory.deploy(
      2 // desination domain
    );

    // 50% of tokens should be vested
    tranches = [
      { time: now - 100n, vestedFraction: 1000n },
      { time: now - 1n, vestedFraction: 5000n },
      { time: now + 100n, vestedFraction: 10000n },
    ]

    DistributorFactory = await ethers.getContractFactory("CrosschainTrancheVestingMerkle", deployer);
    distributor = await DistributorFactory.deploy(
      token.address,
      connextMockSource.address,
      config.total,
      config.uri,
      config.votingFactor,
      tranches,
      config.proof.merkleRoot,
      0 // no queue delay
    );

    distributorWithQueue = await DistributorFactory.deploy(
      token.address,
      connextMockSource.address,
      config.total,
      config.uri,
      config.votingFactor,
      tranches,
      config.proof.merkleRoot,
      maxDelayTime // fair queue is enabled
    );

    SatelliteFactory = await ethers.getContractFactory("Satellite", deployer);
    satellite = await SatelliteFactory.deploy(
      connextMockDestination.address,
      distributor.address,
      1735353714, // source domain
      config.proof.merkleRoot
    )

    // transfer tokens to the distributors
    await token.transfer(distributor.address, await distributor.total())
    await token.transfer(distributorWithQueue.address, await distributorWithQueue.total())
  });

  it("Metadata is correct", async () => {
    expect(await distributor.NAME()).toEqual("CrosschainTrancheVestingMerkle")
    expect(await distributor.VERSION() >= BigNumber.from(1))
    expect(await distributor.uri()).toEqual(config.uri)
  })

  it("Initial distributor configuration is correct", async () => {
    // the distributor total must match (note the adjustment for rounding error)
    expect((await distributor.total()).toBigInt()).toEqual(config.total)
    // nothing has been claimed
    expect((await distributor.claimed()).toBigInt()).toEqual(0n)

    const distributorTranches = await distributor.getTranches()

    expect(distributorTranches.length).toEqual(tranches.length)

    for (let [i, tranche] of distributorTranches.entries()) {
      expect(tranche.time.toBigInt()).toEqual(tranches[i].time)
      expect(tranche.vestedFraction.toBigInt()).toEqual(tranches[i].vestedFraction)
    }

    // no claims have been initialized yet!
    for (let user of [eligible1, eligible2, eligible3, ineligible]) {
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
  })

  it("Can claim via EOA signature", async () => {
    const user = eligible1

    const [beneficiary, amount, domain] = config.proof.claims[user.address.toLowerCase()].data.map(d => d.value)
    const proof = config.proof.claims[user.address.toLowerCase()].proof

    const txData = [
      { name: "recipient", type: "address", value: user.address },
      { name: "recipientDomain", type: "uint32", value: domain },
      { name: "beneficiary", type: "address", value: user.address },
      { name: "beneficiaryDomain", type: "uint32", value: domain },
      { name: "amount", type: "uint256", value: amount }
    ]

    const hash = ethers.utils.arrayify(ethers.utils.solidityKeccak256(txData.map(t => t.type), txData.map(t => t.value)))
    const signature = await user.signMessage(hash)

    // check that user can't claim with invalid signature
    const badSignature = await user.signMessage('bad hash')
    await expect(distributor.connect(user).claimBySignature(
      user.address,
      domain,
      user.address,
      domain,
      amount,
      badSignature,
      proof
    )).rejects.toMatchObject({ message: expect.stringMatching(/!recovered/) })

    let balance = await token.balanceOf(user.address)
    expect(balance.toBigInt()).toEqual(0n)


    // check that user can't claim with invalid proof
    const badProof = [
      "0xc7da9af04efd13b603589588a13c9e63474c4d79452a944db4e9c7d2d2c7db1e"
    ]
    await expect(distributor.connect(user).claimBySignature(
      user.address,
      domain,
      user.address,
      domain,
      amount,
      signature,
      badProof
    )).rejects.toMatchObject({ message: expect.stringMatching(/invalid proof/) })

    balance = await token.balanceOf(user.address)
    expect(balance.toBigInt()).toEqual(0n)

    await distributor.connect(user).claimBySignature(
      user.address,
      domain,
      user.address,
      domain,
      amount,
      signature,
      proof
    )

    const now = BigInt(await time.latest());

    balance = await token.balanceOf(user.address)
    expect(balance.toBigInt()).toEqual(BigInt(amount) / 2n)

    const distributionRecord = await distributor.getDistributionRecord(user.address)

    expect(distributionRecord.total.toBigInt()).toEqual(BigInt(amount))
    expect(distributionRecord.initialized).toEqual(true)
    expect(distributionRecord.claimed.toBigInt()).toEqual(BigInt(amount) / 2n)

    // check that user can't claim again
    await expect(distributor.connect(user).claimBySignature(
      user.address,
      domain,
      user.address,
      domain,
      amount,
      signature,
      proof
    )).rejects.toMatchObject({ message: expect.stringMatching(/no more tokens claimable right now/) })
  })

  it("Can claim via Merkle Proof", async () => {
    const user = eligible2

    const [beneficiary, amount, domain] = config.proof.claims[user.address.toLowerCase()].data.map(d => d.value)
    const proof = config.proof.claims[user.address.toLowerCase()].proof

    // check that user can't claim with invalid proof
    const badProof = [
      "0xc7da9af04efd13b603589588a13c9e63474c4d79452a944db4e9c7d2d2c7db1e"
    ]
    await expect(distributor.connect(user).claimByMerkleProof(
      user.address,
      amount,
      badProof
    )).rejects.toMatchObject({ message: expect.stringMatching(/invalid proof/) })

    await distributor.connect(user).claimByMerkleProof(
      user.address,
      amount,
      proof
    )

    const balance = await token.balanceOf(user.address)
    expect(balance.toBigInt()).toEqual(BigInt(amount) / 2n)

    const distributionRecord = await distributor.getDistributionRecord(user.address)

    expect(distributionRecord.total.toBigInt()).toEqual(BigInt(amount))
    expect(distributionRecord.initialized).toEqual(true)
    expect(distributionRecord.claimed.toBigInt()).toEqual(BigInt(amount) / 2n)
  })

  it("Ineligible user cannot claim", async () => {
    const user = ineligible

    const [beneficiary, amount, domain] = config.proof.claims[eligible3.address.toLowerCase()].data.map(d => d.value)
    const proof = config.proof.claims[eligible3.address.toLowerCase()].proof

    const txData = [
      { name: "recipient", type: "address", value: user.address },
      { name: "recipientDomain", type: "uint32", value: domain },
      { name: "beneficiary", type: "address", value: eligible3.address },
      { name: "beneficiaryDomain", type: "uint32", value: domain },
      { name: "amount", type: "uint256", value: amount }
    ]

    const hash = ethers.utils.arrayify(ethers.utils.solidityKeccak256(txData.map(t => t.type), txData.map(t => t.value)))
    const signature = await user.signMessage(hash)

    await expect(distributor.connect(user).claimBySignature(
      user.address,
      domain,
      eligible3.address,
      domain,
      amount,
      signature,
      proof
    )).rejects.toMatchObject({ message: expect.stringMatching(/!recovered/) })

    await expect(distributor.connect(user).claimByMerkleProof(
      user.address,
      amount,
      proof
    )).rejects.toMatchObject({ message: expect.stringMatching(/invalid proof/) })
  })


  it("Can claim via Connext calls", async () => {
    // user calls satellite on domain 2
    // satellite calls connext on domain 2
    // connext on domain 1735353714 calls distributor on domain 1735353714
    const user = eligible3

    const [beneficiary, amount, domain] = config.proof.claims[user.address.toLowerCase()].data.map(d => d.value)
    const proof = config.proof.claims[user.address.toLowerCase()].proof

    const transactionData = await satellite.connect(user).initiateClaim(
      amount,
      proof
    )

    const transactionReceipt = await transactionData.wait()
    const iface = new ethers.utils.Interface(SatelliteDefinition.abi)
    const { logs } = transactionReceipt
    const transferId = iface.parseLog(logs[1]).args[0]

    await connextMockSource.connect(user).callXreceive(
      transferId,
      amount,
      otherToken.address,
      user.address,
      2,
      proof,
      distributor.address
    )

    const distributionRecord = await distributor.getDistributionRecord(user.address)

    expect(distributionRecord.initialized).toEqual(true)
    expect(distributionRecord.total.toBigInt()).toEqual(BigInt(amount))
    expect(distributionRecord.claimed.toBigInt()).toEqual(BigInt(amount) / 2n)
    // tokens were not claimed to this chain
    expect((await token.balanceOf(user.address)).toBigInt()).toEqual(0n)
  })

  /**
   * @dev Verify that users can be delayed when the queue is enabled
   * TODO: sometimes this test fails with errors like this: invalid address (argument="address", value="0x46627f4094a53e8fb6fd287c69aeea7a54bc751", code=INVALID_ARGUMENT, version=address/5.4.0)
   * Likely cause: ethereum addresses must be 40 characters, but that is 41! Why is the randomValue producing values outside the ETH address space?
   */
  it("Queue Delay works as expected", async () => {


    // Get the largest possible uint160 (this number is all "1"s when displayed in binary)
    const maxUint160 = 2n ** 160n - 1n;
    // get the current random value of the sale
    const randomValue = (await distributorWithQueue.randomValue()).toBigInt();
    // the random value should never be zero
    expect(randomValue).not.toBe(BigInt(0))

    // get the number the furthest distance from the random value by the xor metric (flip all bits in the number so the distance is maxUint160)
    const xorValue = BigInt(randomValue) ^ maxUint160;

    const closestAddress = `0x${randomValue.toString(16)}`;
    const furthestAddress = `0x${xorValue.toString(16)}`;

    // the random value taken as an address should have a delay of 0 for both distributors
    expect((await distributorWithQueue.getFairDelayTime(closestAddress)).toBigInt()).toEqual(0n);
    expect((await distributor.getFairDelayTime(closestAddress)).toBigInt()).toEqual(0n);

    // the furthest address should have the largest delay for the distributor with the queue
    // the delay for the xor of the random value converted to an address must be the maximum queue time
    expect((await distributorWithQueue.getFairDelayTime(furthestAddress)).toBigInt()).toEqual(maxDelayTime);

    // the furthest address should not have any delay if the queue is not enabled
    expect((await distributor.getFairDelayTime(furthestAddress)).toBigInt()).toEqual(0n);

    // ensure the delay is drawn from [0, maxQeuueTime] for real users and correctly gates each user
    const users = [eligible1, eligible2];

    for (let user of users) {
      const delay = (await distributorWithQueue.getFairDelayTime(user.address)).toBigInt();
      expect(delay).toBeGreaterThanOrEqual(0n);
      expect(delay).toBeLessThanOrEqual(maxDelayTime);

      // set the tranches of the distributor so that the user should be able to claim 100% of tokens 2 seconds in the future
      const now = BigInt(await time.latest());
    
      await time.increase(delay);

      await distributorWithQueue.setTranches([
        { time: now + 2n, vestedFraction: 10000n },
      ])

      const [, amount,] = config.proof.claims[user.address.toLowerCase()].data.map(d => d.value)
      const proof = config.proof.claims[user.address.toLowerCase()].proof
  
      // verify the user cannot yet claim
      await expect(distributorWithQueue.claimByMerkleProof(
        user.address,
        amount,
        proof
      )).rejects.toBeTruthy()
      // TODO: why does this more specific error check not work
      // toMatchObject({ message: expect.stringMatching(/Distributor: no more tokens claimable right now/) })

      const distributionRecord = await distributorWithQueue.getDistributionRecord(user.address)

      // wait for three seconds
      await time.increase(3);

      // verify the user can now claim all tokens
      await distributorWithQueue.connect(user).claimByMerkleProof(
        user.address,
        amount,
        proof
      )
    }
  });
})
