import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";
import { ethers } from 'hardhat'
import { GenericERC20, CrosschainTrancheVestingMerkle__factory, CrosschainTrancheVestingMerkle, ERC20, GenericERC20__factory, IConnext, Satellite__factory, Satellite, ConnextMock__factory, ConnextMock } from "../../typechain-types";
import { lastBlockTime } from "../lib";
import SatelliteDefinition from '../../artifacts/contracts/claim/Satellite.sol/Satellite.json'

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
let satellite: Satellite

let tranches: Tranche[]

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
    
    // get the last block time after a recent transaction to make sure it is recent
    let now = await lastBlockTime();
    
    tranches = [
      {time: now - 100n, vestedFraction: 1000n},
      {time: now - 50n, vestedFraction: 5000n},
      {time: now - 10n, vestedFraction: 10000n},
    ]
    
    DistributorFactory = await ethers.getContractFactory("CrosschainTrancheVestingMerkle", deployer);
    distributor = await DistributorFactory.deploy(
      token.address,
      connextMockSource.address,
      config.total,
      config.uri,
      config.votingFactor,
      tranches,
      config.proof.merkleRoot
    );

    SatelliteFactory = await ethers.getContractFactory("Satellite", deployer);
    satellite = await SatelliteFactory.deploy(
      connextMockDestination.address,
      distributor.address,
      1735353714, // source domain
      config.proof.merkleRoot
    )

    // transfer tokens to the distributor
    await token.transfer(distributor.address, await distributor.total())
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

    balance = await token.balanceOf(user.address)
    expect(balance.toBigInt()).toEqual(BigInt(amount))

    const distributionRecord = await distributor.getDistributionRecord(user.address)

    expect(distributionRecord.total.toBigInt()).toEqual(BigInt(amount))
    expect(distributionRecord.initialized).toEqual(true)
    expect(distributionRecord.claimed.toBigInt()).toEqual(BigInt(amount))

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
    expect(balance.toBigInt()).toEqual(BigInt(amount))

    const distributionRecord = await distributor.getDistributionRecord(user.address)

    expect(distributionRecord.total.toBigInt()).toEqual(BigInt(amount))
    expect(distributionRecord.initialized).toEqual(true)
    expect(distributionRecord.claimed.toBigInt()).toEqual(BigInt(amount))
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
    expect(distributionRecord.claimed.toBigInt()).toEqual(BigInt(amount))
    // tokens were not claimed to this chain
    expect((await token.balanceOf(user.address)).toBigInt()).toEqual(0n)
  })
})
