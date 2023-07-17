import { ContractTransaction } from 'ethers'
import hre from 'hardhat'
import { GovernorMultiSourceUpgradeable } from '../typechain-types'
import { ProposalCreatedEvent } from '../typechain-types/contracts/governance/GovernorMultiSourceUpgradeable'
import { NewSaleEvent } from '../typechain-types/contracts/sale/v2/FlatPriceSaleFactory'
import { time } from "@nomicfoundation/hardhat-network-helpers";

const ethers = (hre as any).ethers

export const provider = new ethers.providers.JsonRpcProvider("http://localhost:8545")

// wait for a certain # of milliseconds
export const getSaleId = async (tx): Promise<string> => {
  return (await tx.wait()).events[0].topics[1]
}

export const getSaleAddress_2_0 = async (tx: ContractTransaction) => {
  const receipt = await tx.wait()

  for (let e of receipt.events!) {
    if (e.event == 'NewSale') {
      const newSaleEvent = e as NewSaleEvent
      return newSaleEvent.args[1]
    }
  }

  throw new Error('no matching event found')
}

export const getGovernorProposalId = async (tx: ContractTransaction) => {
  const receipt = await tx.wait()

  for (let e of receipt.events!) {
    if (e.event == 'ProposalCreated') {
      const proposalCreatedEvent = e as any
      return proposalCreatedEvent.args[0]
    }
  }

  throw new Error('no matching event found')
}

export const fillEmptyBlock = async (nBlocks: number | bigint = 1n) => {
  const [deployer ] = await ethers.getSigners();
  // run some meaningless transactions to use up a block () based on Hardhat's automine feature: https://hardhat.org/hardhat-network/docs/explanation/mining-modes
  for (let i = 0; i < nBlocks; i++) {
    // zero-valued transaction to one self
    await deployer.sendTransaction({
      to: deployer.address,
      value: 0
    })
  }
}

// wait for a certain # of milliseconds
export const delay = ms => new Promise(res => setTimeout(res, ms))

export const expectCloseEnough = (a: bigint, b: bigint, limit: bigint) => {
  // expect a and b to be close to each other (within the difference)
  expect((a > b ? a - b : b - a)).toBeLessThanOrEqual(limit)
}

type TrancheStruct = {
  time: string;
  vestedFraction: string;
}

export const makeUniformTranches = async (trancheCount = 48n, trancheDelay = 3600n, startTime?: bigint) => {
  // creates a uniform vesting schedule
  if (!startTime) {
    startTime = BigInt(await time.latest())
  }
	let tranches: TrancheStruct[] = []

	// create 48 tranches of hourly vesting with the first tranche available immediately
	for (let i: bigint = 0n; i < trancheCount; i++) {
		tranches.push({
			// each tranche is an hour later
      time: (startTime + trancheDelay * i).toString(),
			// each tranche vests an additional 1/48th of the token
			vestedFraction: ((i + 1n) * 10000n / trancheCount).toString()
    })
	}
	return tranches
}

export const makeMonthlyTranches = (startingDate: Date, startingFraction: number = 208, trancheCount = 48) => {
  /**
    creates tranches that vest on the same day each month
    - startingDate: the date when the first tranche vests (does not need to be the same day of the month as the subsequent tranches)
    - startingFraction: the initial unlock expressed as basis points (eg 1500 = 15%)
    - dayOfMonth: the day on which the next tranche should unlock (defaults to the first of each month)
    - trancheCount: the number of months required to complete all vesting, including the starting tranche
  */

  if (startingFraction > 10000) {
    throw new Error('starting fraction over 10000 basis points (100%)')
  }

  if (startingDate.getDate() > 28) throw new Error('cannot vest on the 29th or later date!')

	let tranches: TrancheStruct[] = []
	// create 48 tranches of hourly vesting with the first tranche available immediately
	for (let i = 0; i < trancheCount; i++) {
    // handle the first tranche
    const time = i == 0
      ? (startingDate.getTime()/1000).toString()
      : Math.round(Date.UTC(startingDate.getUTCFullYear(), startingDate.getUTCMonth() + i, startingDate.getUTCDate(), startingDate.getUTCHours())/1000).toString()
  
		const vestedFraction = i == 0
      ? startingFraction.toString()
      : (startingFraction + (Math.round(i * (10000 - startingFraction) / (trancheCount - 1)))).toString()

		tranches.push({
      time,
      vestedFraction
    })
	}

	return tranches
}

