# Sherlock Cross-Chain Distributor Audit

## Setup
* Install: `yarn`
* Testing: `yarn chain` + `yarn test`

## About the cross-chain distributor
The two contracts that will be used in conjunction are `Satellite.sol` and `CrosschainTrancheVestingMerkle.sol`. Together, they allow an admin to set up an airdrop across multiple chains. We can safely assume that the Distributor contract owner is a trusted party.

These contracts allow the owner to:
* determine eligibility, token quantities, and domain for the airdrop using a merkle root (e.g. address A gets 100 USDC tokens on Ethereum, address B gets 200 USDC tokens on Arbitrum)
* determine vesting schedule (e.g. 10% of the tokens vest August 1, 80% vest September 1, and the final 10% vest October 1).
* update eligibility and vesting as required

The beneficiaries (i.e. those people that will receive tokens in the airdrop) can be either EOAs or smart contracts, and can claim tokens in several ways:
* with a merkle proof (`crosschainTrancheVestingMerkle.claimByMerkleProof()`) - EOA and smart contract: must receive tokens on address and chain specified in the merkle leaf
* with a signature (`crosschainTrancheVestingMerkle.claimBySignature()`) - EOA only: can receive tokens on a different address or chain because the signature proves the beneficiary in the merkle leaf wants tokens somewhere else
* through a cross-chain satellite (`satellite.initiateClaim()`) - EOA and smart contract: must receive tokens on address and chain specified in the merkle leaf

Important: these contract rely on Connext correctly passing messages between chain. Of course, Connext working correctly is out of scope for this audit.

The best place to start (including a sample merkle proof) is `test/distributor/CrosschainTrancheVestingMerkle.test.ts`.

Note on testing Connext: in practice, one Connext contract will be deployed per domain/chain, but for these tests we deploy two Connext mocks to the same chain with different domains recorded.

# Regular Readme

    ███████  ██████  ███████ ████████  
    ██      ██    ██ ██         ██     
    ███████ ██    ██ █████      ██     
         ██ ██    ██ ██         ██     
    ███████  ██████  ██         ██      
                                                               
                                                               
# Soft DAO Core Primitives

Key smart contracts are found in the `./contracts` folder and cover several use cases:
* `./claim`: distribute tokens, including lockup conditions like vesting (continuous, tranche-based, or price-based) and voting power
* `./governance`: create a DAO, including DAO governor and timelock which allow DAO members to vote with tokens held in a vesting contract
* `./interfaces`: reference these interfaces when building third-party contracts relying on Soft DAO primitives
* `./mocks`: stubbed out contracts used for testing and development - do not use these in production
* `./payment`: receive arbitrary payments from users and track how much they have sent
* `./sale`: sell tokens to users. Sales can include access restrictions, fair random queues, multiple payment methods
* `./token`: commonly used token standards
* `./utilities`: other useful contracts such as a contract registry

## Using Deployed Soft DAO contracts
Find the right contracts in the [Deployed Smart Contracts](#Deployed-Smart-Contracts) section below.

### Launching a sale
Use the FlatPriceSaleFactory contract to create a new sale.


```typescript
import { ethers } from 'hardhat'

const SaleFactoryFactory = await ethers.getContractFactory("FlatPriceSaleFactory", admin);

[deployer, admin] = await ethers.getSigners();

config = {
    // recipient of sale proceeds
    recipient: recipient.address,
    // merkle root determining sale access
    merkleRoot: merkleRoots.public,
    // merkleRoots.public,
    // sale maximum ($1,000,000) - note the 8 decimal precision!
    saleMaximum: 1e6 * 1e8,
    // user maximum ($1,000)
    userMaximum: 1e3 * 1e8,
    // purchase minimum ($1)
    purchaseMinimum: 1 * 1e8,
    // start time: now
    startTime: Math.floor(new Date().getTime() / 1000),
    // end time (10 days from now)
    endTime: Math.floor(new Date(new Date().getTime() + 10 * 24 * 3600 * 1000).getTime() / 1000),
    // max fair queue time 1 hour
    maxQueueTime: 3600,
    // information about the sale
    URI: 'https://example.com'
}

const publicSaleTx = await saleFactory.newSale(
    // the owner of the new sale (can later modify the sale)
    deployer.address,
    // the sale configuration
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
```

### Reviewing the registry
Use the registry contracts below to find other official Soft DAO contracts. The registry is used to mark specific addresses as authentic contracts supporting specific interfaces following the [ERC-165](https://eips.ethereum.org/EIPS/eip-165) standard, and the easiest way to decode the Registry contracts is via a subgraph watching the registry, such as those deployed by [Tokensoft](https://thegraph.com/hosted-service/subgraph/tokensoft/sales-mainnet).

Note that lowercase contract addresses are used as subgraph entity IDs.

#### Subgraph Example
URL: https://thegraph.com/hosted-service/subgraph/tokensoft/sales-mainnet
Query:
```graphql
{
  registry(id: "0xc70573b924c92618e6143f6ac4c2b1ad7ba8785b") {
    addresses {
      id
      interfaceIds
      interfaceNames
    }
  }
}
```

Response:
```json
{
  "data": {
    "registry": {
      "addresses": [
        {
          "id": "0xf266195e1b30b8f536834303c555bd6aaf063f04",
          "interfaceIds": [
            "0xab85ea0e",
            "0xfc57b782",
            "0x09e04257",
            "0x35ef410e"
          ],
          "interfaceNames": [
            "IDistributor",
            "IAdvancedDistributor",
            "IContinuousVesting",
            "IMerkleSet"
          ]
        }
      ]
    }
  }
}
```

This resonse means that the address `0xf266195e1b30b8f536834303c555bd6aaf063f04` is known to the Soft DAO as a Distributor and includes advanced features, a merkle root access list, and continuous vesting. See the two files below for more information on the interfaces.

#### `./subgraph/abis/interfaces.json`
This file includes the ERC-165 interface for each Solidity contract/interface as well as the source solidity file defining the interface.

Example results:
```json
{
  "Registry": {
    "source": "contracts/utilities/Registry.sol",
    "id": "0xe711948a"
  },
  "FlatPriceSaleFactory": {
    "source": "contracts/sale/v2/FlatPriceSaleFactory.sol",
    "id": "0xfcb73502"
  },
  "FlatPriceSale": {
    "source": "contracts/sale/v2/FlatPriceSale.sol",
    "id": "0x7a6d298d"
  },
  "IERC20": {
    "source": "@openzeppelin/contracts/token/ERC20/IERC20.sol",
    "id": "0x36372b07"
  },
  "IVotes": {
    "source": "@openzeppelin/contracts/governance/utils/IVotes.sol",
    "id": "0xe90fb3f6"
  },
  ...
}
```

#### `./subgraph/build/interfaces.ts`
This file allows one to reference the interfaces when developing a subgraph.

```typescript
import { TypedMap } from "@graphprotocol/graph-ts"

class knownInterfacesClass extends TypedMap<string, string>{
  constructor(){
	super()

	// map interface names to ids AND ids to names

    this.set("Sweepable", "0xac1d7eef")
    this.set("0xac1d7eef", "Sweepable") 
    ...
  }
  
  // convenience getters to emulate an object in AssemblyScript 
  get Sweepable(): string {
    let value = this.get("Sweepable")
    return value!.toString()
  }
  ...
}

export const knownInterfaces = new knownInterfacesClass
```

Example AssemblyScript mapping file `exampleMapping.ts`
```typescript
import {knownInterfaces} from '../../generated/interfaces'

// do something based on interface ID
if (registeredAddress.interfaceIds.includes(knownInterfaces.IDistributor)) {
    log.info('Registered {} as a Distributor', [registeredAddress.id])
    saveDistributor(distributor.id, block)
}
```

## Using Soft DAO source
The contracts are licensed under the MIT license. Use them however you like - we'd appreciate a note that your core primitives are based on the Soft DAO!

# Deployed Smart Contracts

## Avalanche
- [0x9Ef415dE715c0a55AA867bcDEa00eAf914aD6cb7](https://snowtrace.io/address/0x9Ef415dE715c0a55AA867bcDEa00eAf914aD6cb7)
- [0x92DcF0aFD197E73345c893b856B93ee68CB61809](https://snowtrace.io/address/0x92DcF0aFD197E73345c893b856B93ee68CB61809)
- [0x245A9bD01ccF512D1374BE4F7A8Eb06dA21E6333](https://snowtrace.io/address/0x245A9bD01ccF512D1374BE4F7A8Eb06dA21E6333)

## Avalanche Fuji
- [0xfE245D36F8b4079C62B74eD4FfE7B055DB1B5A2D](https://testnet.snowtrace.io/address/0xfE245D36F8b4079C62B74eD4FfE7B055DB1B5A2D)
- [0x55ee754b2cf0ccb70b808c47321ca1ad7ef0e118](https://testnet.snowtrace.io/address/0x55ee754b2cf0ccb70b808c47321ca1ad7ef0e118)
- [0xB7488893AF633EFdAEB95F496B7D2FF2C50f1A9A](https://testnet.snowtrace.io/address/0xB7488893AF633EFdAEB95F496B7D2FF2C50f1A9A)

## Ethereum Mainnet
- [0x865D024BFd9e1C2Cd665fAc6666c5C3E4a375dd7](https://www.etherscan.io/address/0x865D024BFd9e1C2Cd665fAc6666c5C3E4a375dd7)
- [0x135D889aFF58584e12ab3bd4ce327a18aF3356Ef](https://www.etherscan.io/address/0x135D889aFF58584e12ab3bd4ce327a18aF3356Ef)
- [0xc70573B924C92618E6143F6ac4C2B1aD7ba8785b](https://www.etherscan.io/address/0xc70573B924C92618E6143F6ac4C2B1aD7ba8785b)

## Polygon
- [0x17c14f6087C62666D28361697f4a9B4D39DC3Bc5](https://polygonscan.com/address/0x17c14f6087c62666d28361697f4a9b4d39dc3bc5)
- [0x07537efBa62504425f879E9D60A25aB09D139161](https://polygonscan.com/address/0x07537efBa62504425f879E9D60A25aB09D139161)
- [0xf9d55F554175B8a18cDB167063383f5462442EAD](https://polygonscan.com/address/0xf9d55F554175B8a18cDB167063383f5462442EAD)

## Ethereum Goerli
- [0x55ee754b2cf0ccb70b808c47321ca1ad7ef0e118](https://goerli.etherscan.io/address/0x55ee754b2cf0ccb70b808c47321ca1ad7ef0e118)
- [0xB7488893AF633EFdAEB95F496B7D2FF2C50f1A9A](https://goerli.etherscan.io/address/0xB7488893AF633EFdAEB95F496B7D2FF2C50f1A9A)
- [0x3a03bF4106404B94d426bC31B831889f0d43960b](https://goerli.etherscan.io/address/0x3a03bF4106404B94d426bC31B831889f0d43960b)

## Polygon Mumbai
- [0x31b7625997603Ce07B349d6f0300B6CB5896959b](https://mumbai.polygonscan.com/address/0x31b7625997603Ce07B349d6f0300B6CB5896959b)
- [0x493E0a1f8304832658c461c2EaBfaeCeeE507097](https://mumbai.polygonscan.com/address/0x493E0a1f8304832658c461c2EaBfaeCeeE507097)
- [0x7afd2700F8e915ed4D39897d0D284A54e6348Ad3](https://mumbai.polygonscan.com/address/0x7afd2700F8e915ed4D39897d0D284A54e6348Ad3)

## Arbitrum Goerli
- [0x07537efBa62504425f879E9D60A25aB09D139161](https://goerli.arbiscan.io/address/0x07537efBa62504425f879E9D60A25aB09D139161)
- [0x17c14f6087C62666D28361697f4a9B4D39DC3Bc5](https://goerli.arbiscan.io/address/0x17c14f6087C62666D28361697f4a9B4D39DC3Bc5)
- [0x71bE8339023d779f2f85893761729Bb27b97891d](https://goerli.arbiscan.io/address/0x71bE8339023d779f2f85893761729Bb27b97891d)

## Celo Alfajores
- [0x9c2D86d00aFDe6e616CADfBc0fe2D47C1d22b1c8](https://alfajores.celoscan.io/address/0x9c2D86d00aFDe6e616CADfBc0fe2D47C1d22b1c8)
- [0xeEDB0e8e589F9ADf6768fc006BaA1C6462f5e563](https://alfajores.celoscan.io/address/0xeEDB0e8e589F9ADf6768fc006BaA1C6462f5e563)
- [0x000047203100A45635029eC21bbBec5EC53Cb6f6](https://alfajores.celoscan.io/address/0x000047203100A45635029eC21bbBec5EC53Cb6f6)

## Celo
- [0xb41169Cc124298Be20e2Ca956cC46E266ab5E203](https://explorer.celo.org/mainnet/address/0xb41169Cc124298Be20e2Ca956cC46E266ab5E203)
- [0xC61da7Db4981c8839b51B32d4c83cCdf47ca0b20](https://explorer.celo.org/mainnet/address/0xC61da7Db4981c8839b51B32d4c83cCdf47ca0b20)
- [0xA82d7ED01c31DD2A46681D18E3E213C9E9231605](https://explorer.celo.org/mainnet/address/0xA82d7ED01c31DD2A46681D18E3E213C9E9231605)

## Optimism
- [0xb41169Cc124298Be20e2Ca956cC46E266ab5E203](https://optimistic.etherscan.io/address/0xb41169cc124298be20e2ca956cc46e266ab5e203)
- [0xC61da7Db4981c8839b51B32d4c83cCdf47ca0b20](https://optimistic.etherscan.io/address/0xC61da7Db4981c8839b51B32d4c83cCdf47ca0b20)
- [0xA82d7ED01c31DD2A46681D18E3E213C9E9231605](https://optimistic.etherscan.io/address/0xA82d7ED01c31DD2A46681D18E3E213C9E9231605)

## Arbitrum
- [0xb41169Cc124298Be20e2Ca956cC46E266ab5E203](https://arbiscan.io/address/0xb41169Cc124298Be20e2Ca956cC46E266ab5E203)
- [0xC61da7Db4981c8839b51B32d4c83cCdf47ca0b20](https://arbiscan.io/address/0xC61da7Db4981c8839b51B32d4c83cCdf47ca0b20)
- [0xa82d7ed01c31dd2a46681d18e3e213c9e9231605](https://arbiscan.io/address/0xa82d7ed01c31dd2a46681d18e3e213c9e9231605)

## Binance Smart Chain
- [0xb41169Cc124298Be20e2Ca956cC46E266ab5E203](https://bscscan.com/address/0xb41169Cc124298Be20e2Ca956cC46E266ab5E203)
- [0xC61da7Db4981c8839b51B32d4c83cCdf47ca0b20](https://bscscan.com/address/0xC61da7Db4981c8839b51B32d4c83cCdf47ca0b20)
- [0xA82d7ED01c31DD2A46681D18E3E213C9E9231605](https://bscscan.com/address/0xA82d7ED01c31DD2A46681D18E3E213C9E9231605)

