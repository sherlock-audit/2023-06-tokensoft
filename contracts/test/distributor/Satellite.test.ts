import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { ethers } from 'hardhat'
import { GenericERC20, Satellite, ConnextMock } from "../../typechain-types";
import { lastBlockTime } from "../lib";
import SatelliteDefinition from '../../artifacts/contracts/claim/Satellite.sol/Satellite.json'

jest.setTimeout(30000);

type Tranche = {
  time: bigint
  vestedFraction: bigint
}

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

let deployer: SignerWithAddress
let eligible1: SignerWithAddress
let eligible2: SignerWithAddress
let eligible3: SignerWithAddress
let ineligible: SignerWithAddress
let token: GenericERC20
let connext: ConnextMock
let satellite: Satellite

const domain = 2
const distributorDomain = 1735353714
const distributorAddress = '0x94750381be1aba0504c666ee1db118f68f0780d4'

// distributor config
const config: Config = {
  // 2000 tokens
  total: 2000n,
  // any string will work for these unit tests - the uri is not used on-chain
  uri: 'https://example.com',
  // no voting before claims
  votingFactor: 0n,
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

describe("Satellite", function () {
  beforeAll(async () => {
    [deployer, eligible1, eligible2, eligible3, ineligible] = await ethers.getSigners();

    const connextFactory = await ethers.getContractFactory("ConnextMock", deployer);
    connext = await connextFactory.deploy(domain) as ConnextMock

    const satelliteFactory = await ethers.getContractFactory("Satellite", deployer);
    satellite = await satelliteFactory.deploy(
      connext.address,
      distributorAddress,
      distributorDomain,
      config.proof.merkleRoot
    ) as Satellite
  });

  it("Metadata is correct", async () => {
    expect((await satellite.distributor()).toLowerCase()).toEqual(distributorAddress)
    expect (await satellite.distributorDomain()).toEqual(distributorDomain)
    expect(await satellite.domain()).toEqual(domain)
    expect(await satellite.connext()).toEqual(connext.address)
    expect(await satellite.getMerkleRoot()).toEqual(config.proof.merkleRoot)
  })

  it("Can start a subsidized cross-chain claim by calling Connext", async () => {
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
    
    expect(transferId).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it("Can start a cross-chain claim including a relayer fee by calling Connext", async () => {
    const user = eligible3

    const [, amount,] = config.proof.claims[user.address.toLowerCase()].data.map(d => d.value)
    const proof = config.proof.claims[user.address.toLowerCase()].proof

    const transactionData = await satellite.connect(user).initiateClaim(
      amount,
      proof,
      {value: 1000000000000000n}
    )
    const transactionReceipt = await transactionData.wait()
    const iface = new ethers.utils.Interface(SatelliteDefinition.abi)
    const { logs } = transactionReceipt
    const transferId = iface.parseLog(logs[1]).args[0]
    
    expect(transferId).toMatch(/^0x[0-9a-f]{64}$/)
  })

  it("Distributor domain must not match satellite domain", async () => {
    const satelliteFactory = await ethers.getContractFactory("Satellite", deployer);

    await expect(
      satelliteFactory.deploy(
        connext.address,
        distributorAddress,
        domain, // <-- this is the same as the satellite domain
        config.proof.merkleRoot
      )
  ).rejects.toMatchObject(
    { message: expect.stringMatching(/same domain/) }
  )
  })
})
