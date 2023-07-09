import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber, BigNumberish, BytesLike } from "ethers";
import { ethers } from 'hardhat'
import { BasicDistributor, BasicDistributor__factory, Distributor, ERC20Votes, GenericERC20, GovernorMultiSourceUpgradeable, GovernorMultiSourceUpgradeable__factory, GovernorVotesMultiSourceUpgradeable, GovernorVotesMultiSourceUpgradeable__factory, MyTimelockControllerUpgradeable, MyTimelockControllerUpgradeable__factory, TimelockControllerUpgradeable, TimelockControllerUpgradeable__factory } from "../../typechain-types";

// silly workaround to get the type of open zeppelin's hardhat upgrades from hardhat monkey-patching
import hre from 'hardhat'
import { HardhatUpgrades } from '@openzeppelin/hardhat-upgrades'
import { delay, fillEmptyBlock, getGovernorProposalId, lastBlockTime, provider } from "../lib";
const upgrades = (hre as any).upgrades as HardhatUpgrades

jest.setTimeout(30000);

let GovernorFactory: GovernorMultiSourceUpgradeable__factory
let TimelockFactory: MyTimelockControllerUpgradeable__factory
let BasicDistributorFactory: BasicDistributor__factory
let governor: GovernorMultiSourceUpgradeable
let timelock: MyTimelockControllerUpgradeable

// we will start with these distributors
let distributors: BasicDistributor[] = []

// we will later try to add these distributors
const newDistributors: BasicDistributor[] = []

let votingToken: ERC20Votes
let treasuryToken: GenericERC20
let deployer: SignerWithAddress
let members: SignerWithAddress[] = []
let nonMember: SignerWithAddress

// learn more about the proposal lifecycle at https://docs.openzeppelin.com/contracts/4.x/governance
// from node_modules/@scaffold-eth/hardhat/node_modules/@openzeppelin/contracts-upgradeable/governance/IGovernorUpgradeable.sol
enum ProposalState {
	Pending,
	Active,
	Canceled,
	Defeated,
	Succeeded,
	Queued,
	Expired,
	Executed
}

// voting values are based on Compounds: see https://docs.compound.finance/v2/governance/#cast-vote
enum Vote {
	Against,
	For,
	Abstain
}

// voting tokens that are sent to the DAO itself rather than a DAO member or token vesting contract
let unallocatedVotingTokens: BigNumber

// timelock has minimum delay of 5 seconds
const timelockMinDelay = 5n

// governor voting delay in blocks - see https://docs.openzeppelin.com/contracts/4.x/api/governance#Governor-votingDelay-
// note that we use GovernorMultiSourceUpgradeableMock.sol to override the default value for easier testing!
const votingDelay = 0n

// governor voting period in blocks
// note that we use GovernorMultiSourceUpgradeableMock.sol to override the default value for easier testing!
const votingPeriod = 10n

// number of tokens required to propose - see https://docs.openzeppelin.com/contracts/4.x/api/governance#Governor-votingPeriod-
const proposalThreshold = 100000000000000000000000n

// how many tokens should the i'th member receive from the j'th distributor? (we just need some reasonable allocations)
// i.e. the first user receives 100,000 tokens from the 0'th distributor, the third user receives 30,000,000 tokens from the 2nd distributor, etc.
// note that the token has 18 decimal places
const getVestingTokenCount = (user: number, distributor: number) => (BigInt(user) + 1n) * 10n ** BigInt(distributor + 5) * 10n ** 18n

// how many tokens should the i'th member receive directly
// note that the token has 18 decimal places
// e.g. the first user receives 1m tokens, the second user receives 2m tokens, ...
const getInitialTokenCount = (user: number) => (BigInt(user) + 1n) * 10n ** 6n * 10n ** 18n

// how many tokens in total should the j'th distributor distribute?
const getTokenTotal = (nMembers: number, j: number) => Array.from({ length: nMembers }, (_, i) => getVestingTokenCount(i, j)).reduce((acc: bigint, v: bigint) => acc + v)

// voting factors for the j'th distributor, i.e. distributor 0 = 1.0x, d1 = 1.5x, d2 = 2.0x, ...
const getVoteFactor = (j: number) => 10000n + 5000n * BigInt(j)

// we use this enough to abstract it
const verifyVotes = async (delegated: boolean = true) => {
	console.log(`verifying votes: ${members.length} members, ${distributors.length} distributors`)
	// the governor tallies votes directly from the token and indirectly from the distributor
	for (let [i, member] of members.entries()) {
		// aggregate across all of the user's unvested tokens, including a voting factor
		let votes = distributors.map((_, j) => BigInt(getVestingTokenCount(i, j) * getVoteFactor(j) / 10000n)).reduce((acc, v) => acc + v)
		if (delegated) {
			// tokens have been delegated and can count toward goverance
			votes += (await votingToken.balanceOf(member.address)).toBigInt()
		}
		expect((await governor.getVotes(member.address, await ethers.provider.getBlockNumber() - 1)).toBigInt()).toEqual(votes)
	}
}

// we use this enough to abstract it
const getTotalVotes = async (delegated: boolean = true) => {
	// the governor tallies votes directly from the token and indirectly from the distributor
	let votes = 0n
	for (let [i, member] of members.entries()) {
		// aggregate across all of the user's unvested tokens, including a voting factor
		votes += distributors.map((_, j) => BigInt(getVestingTokenCount(i, j) * getVoteFactor(j) / 10000n)).reduce((acc, v) => acc + v)
		if (delegated) {
			// tokens have been delegated and can count toward goverance
			votes += (await votingToken.balanceOf(member.address)).toBigInt()
		}
	}
	return votes
}

const initializeDistributors = async (distributors: BasicDistributor[], members: SignerWithAddress[]) => {
	// all members delegate to themselves on all distributors
	for (let distributor of distributors) {
		for (let member of members) {
			const myDistributor = await ethers.getContractAt("BasicDistributor", distributor.address, member)
			await myDistributor.delegate(member.address)
		}
	}
	// create an empty block so that the new voting power is included in a snapshot - getPastVotes() relies on a previous block
	await fillEmptyBlock();
}

const executeProposal = async (targets: string[], values: BigNumberish[], calldatas: BytesLike[], proposalDescription: string) => {
	/**
	 * Convenience function to run through the entire DAO governance process and check that it works as expected
	 */
	// members that hold tokens can propose
	const myGovernor = await ethers.getContractAt(
		"GovernorMultiSourceUpgradeable",
		governor.address,
		members[0]
	) as GovernorMultiSourceUpgradeable

	const tx = await myGovernor.propose(
		targets,
		values,
		calldatas,
		proposalDescription
	)

	const proposalId = await getGovernorProposalId(tx)

	// get the block number at which a user's votes and quorum are measured: see https://docs.openzeppelin.com/contracts/4.x/api/governance#IGovernor-proposalSnapshot-uint256-
	// voting begins at the block after the snapshot
	const proposalSnapshot = await governor.proposalSnapshot(proposalId);
	expect(proposalSnapshot.toBigInt()).toEqual(BigInt(tx.blockNumber!) + votingDelay)

	// we are still on the same block as the proposal - voting is not yet active!
	expect(await governor.state(proposalId)).toEqual(ProposalState.Pending)

	// fill as many blocks as required to open voting
	await fillEmptyBlock(votingDelay > 0n ? votingDelay : 1n)

	// we are still on the same block as the proposal - voting is not yet active!
	expect(await governor.state(proposalId)).toEqual(ProposalState.Active)

	// not surprisingly, everyone likes this proposal
	await Promise.all(members.map(async member => {
		const myGovernor = await ethers.getContractAt('GovernorMultiSourceUpgradeable', governor.address, member) as GovernorMultiSourceUpgradeable
		await myGovernor.castVoteWithReason(proposalId, Vote.For, 'much wao, very distribute, great project, to the moon')

		// verify we voted
		expect(await governor.hasVoted(proposalId, member.address)).toEqual(true)
	}))

	// the proposal state has not changed
	expect(await governor.state(proposalId)).toEqual(ProposalState.Active)

	// voting closes at the end of this block
	const proposalDeadline = (await governor.proposalDeadline(proposalId)).toBigInt();

	// fill enough blocks to ensure voting has ended
	await fillEmptyBlock(proposalDeadline - BigInt((await provider.getBlockNumber())) + 1n)

	// see how voting went
	const [votesAgainst, votesFor, votesAbstain] = await governor.proposalVotes(proposalId)

	// total votes for this proposal match
	expect(votesAgainst.toBigInt()).toEqual(0n)
	expect(votesFor.toBigInt()).toEqual(await getTotalVotes())
	expect(votesAbstain.toBigInt()).toEqual(0n)

	// the votes for the proposal must exceed the quorum or the vote will not pass
	expect(votesFor.toBigInt()).toBeGreaterThanOrEqual((await governor.quorum(await ethers.provider.getBlockNumber() - 1)).toBigInt())

	// the proposal should have passed
	expect(await governor.state(proposalId)).toEqual(ProposalState.Succeeded)

	// schedule this proposal on the timelock (note that anyone can call this - the deployer is not affiliated with the DAO)
	const queueTx = await governor.queue(
		targets,
		values,
		calldatas,
		ethers.utils.id(proposalDescription)
	)
	const queueReceipt = await queueTx.wait()

	// the proposal should be queued on the timelock
	expect(await governor.state(proposalId)).toEqual(ProposalState.Queued)

	// get an etimated time when the queued proposal can be executed
	const eta = (await governor.proposalEta(proposalId)).toBigInt()

	// the eta should match our timelock specifications
	expect(eta).toEqual(BigInt((await provider.getBlock(queueReceipt.blockNumber)).timestamp) + timelockMinDelay)

	//wait until the timelock has completed
	await delay(Number(timelockMinDelay) * 1000)

	// any executor can execute the DAO proposal (in this case, members[0])
	await myGovernor.execute(
		targets,
		values,
		calldatas,
		ethers.utils.id(proposalDescription)
	)

	// the proposal should be executed
	expect(await governor.state(proposalId)).toEqual(ProposalState.Executed)
}

describe("GovernorMultiSourceUpgradeable", function () {
	beforeAll(async () => {
		let member1: SignerWithAddress
		let member2: SignerWithAddress
		let member3: SignerWithAddress

		// the _prefix denotes variables inside the beforeAll() scope that must exist that would otherwise be shadowed by the global declarations
		[deployer, nonMember, member1, member2, member3] = await ethers.getSigners();

		members = [
			member1, member2, member3
		]

		// set up some contract factories
		TimelockFactory = await ethers.getContractFactory("MyTimelockControllerUpgradeable", deployer) as MyTimelockControllerUpgradeable__factory;
		// Note that we actually deploy a mock with a shorter voting delay and voting period!
		GovernorFactory = await ethers.getContractFactory("GovernorMultiSourceUpgradeableMock", deployer) as GovernorMultiSourceUpgradeable__factory;
		// these factories are only used in the beforeAll() function
		BasicDistributorFactory = await ethers.getContractFactory("BasicDistributor", deployer);
		const ERC20VotesFactory = await ethers.getContractFactory("MyERC20Votes", deployer);
		const GenericERC20Factory = await ethers.getContractFactory("GenericERC20", deployer);

		const uri = 'https://example.com'

		votingToken = await ERC20VotesFactory.deploy(
			"Neue Crypto Token",
			"NCT",
			// 1B tokens
			'1000000000000000000000000000'
		) as ERC20Votes;

		treasuryToken = await GenericERC20Factory.deploy(
			"US Dollar Coin",
			"USDC",
			// decimals
			6,
			// 1B tokens
			1000000000n * 1000000n
		) as GenericERC20;

		// set up some distributors with varying quantities for each user
		for (let n = 0; n < 3; n++) {
			distributors.push(await BasicDistributorFactory.deploy(
				votingToken.address,
				getTokenTotal(members.length, n),
				uri,
				getVoteFactor(n),
				members.map(b => b.address),
				members.map((v, i) => getVestingTokenCount(i, n))
			) as BasicDistributor)
		}

		// set up a few more distributors for later use
		for (let n = distributors.length; n < distributors.length + 2; n++) {
			newDistributors.push(await BasicDistributorFactory.deploy(
				votingToken.address,
				getTokenTotal(members.length, n),
				'https://example.com',
				getVoteFactor(n),
				members.map(b => b.address),
				members.map((v, i) => getVestingTokenCount(i, n))
			) as BasicDistributor)
		}

		// deploy a timelock contract as an upgradeable proxy
		timelock = await upgrades.deployProxy(TimelockFactory, undefined, { initializer: false, }) as MyTimelockControllerUpgradeable

		// deploy a governor contract as an upgradeable proxy
		governor = await upgrades.deployProxy(GovernorFactory, undefined, { initializer: false }) as GovernorMultiSourceUpgradeable

		// DAO contract initialization requires the other DAO contract address - do it manually instead of within the deployProxy() call
		await governor.initialize(
			votingToken.address,
			timelock.address,
			distributors.map(d => d.address)
		)

		// see https://docs.openzeppelin.com/contracts/4.x/access-control
		await timelock.initialize(
			// min delay
			timelockMinDelay,
			// proposers: only the DAO governor can propose actions
			[governor.address],
			// executors: the DAO and a few friendly DAO members
			[governor.address, ...members.map(m => m.address)]
		)

		// transfer some voting tokens to the distributors
		await Promise.all(distributors.map(async (distributor) => {
			await votingToken.transfer(distributor.address, await distributor.total())
		}))

		// transfer some voting tokens directly to various members
		await Promise.all(members.map(async (member, i) => {
			await votingToken.transfer(member.address, getInitialTokenCount(i))
		}))

		// send ALL OF THE TREASURY TOKEN INTO THE DAO (fingers crossed!)
		await treasuryToken.transfer(timelock.address, await treasuryToken.balanceOf(deployer.address))

		// The remaining voting tokens not sent to a user or a vesting contract
		unallocatedVotingTokens = (await votingToken.balanceOf(deployer.address))

		// send unallocated voting tokens directly to the DAO
		await votingToken.transfer(timelock.address, unallocatedVotingTokens)

		await initializeDistributors(distributors, members)
	});

	it("Distributors are set up correctly", async () => {
		// do some sanity checks on tokens vesting setup (the distributors themselves are tested elsewhere)
		expect((await distributors[0].getVotes(members[0].address)).toBigInt()).toEqual(
			1n * 10n ** 5n * 1n * 10n ** 18n
		)

		expect((await distributors[1].getVotes(members[1].address)).toBigInt()).toEqual(
			2n * 10n ** 6n * 10n ** 18n * 15n / 10n
		)

		expect((await distributors[2].getVotes(members[2].address)).toBigInt()).toEqual(
			3n * 10n ** 7n * 2n * 10n ** 18n
		)
	})

	it("Voting token balances are set up correctly", async () => {
		// All tokens have been sent elsewhere
		expect((await votingToken.balanceOf(deployer.address)).toBigInt()).toEqual(0n)
		// IMPORTANT: DO NOT PUT TOKENS IN THE GOVERNOR! THEY WILL BE LOST FOREVER!
		expect((await votingToken.balanceOf(governor.address)).toBigInt()).toEqual(0n)
		// Tokens go in the timelock (remainder of NCT)
		expect(await votingToken.balanceOf(timelock.address)).toEqual(unallocatedVotingTokens)
	})

	it("Treasury token balances are set up correctly", async () => {
		// All tokens have been sent elsewhere
		expect((await treasuryToken.balanceOf(deployer.address)).toBigInt()).toEqual(0n)
		// IMPORTANT: DO NOT PUT TOKENS IN THE GOVERNOR! THEY WILL BE LOST FOREVER!
		expect((await treasuryToken.balanceOf(governor.address)).toBigInt()).toEqual(0n)
		// Tokens go in the timelock (1B USDC)
		expect((await treasuryToken.balanceOf(timelock.address)).toBigInt()).toEqual(1000000000n * 1000000n)
	})

	it("DAO Governor is set up properly", async () => {
		// we supplied these values
		expect(await governor.token()).toEqual(votingToken.address)
		expect(await governor.timelock()).toEqual(timelock.address)

		// the distributors are recorded successfully
		expect(await governor.getVoteSources()).toEqual(distributors.map(d => d.address))

		// other sanity checks
		expect(await governor.owner()).toEqual(deployer.address)
		expect((await governor.votingDelay()).toBigInt()).toEqual(votingDelay)
		expect((await governor.votingPeriod()).toBigInt()).toEqual(votingPeriod)
		expect((await governor.proposalThreshold()).toBigInt()).toEqual(proposalThreshold)

		// ensure the DAO vote counting mode is what we expect: see https://docs.openzeppelin.com/contracts/4.x/api/governance#IGovernor-COUNTING_MODE--
		expect(await governor.COUNTING_MODE()).toEqual('support=bravo&quorum=for,abstain')

		// the quorum numerator is 5%
		expect((await governor["quorumNumerator()"]()).toBigInt()).toEqual(5n)

		// the number of votes required to reach quorum should match
		expect((await governor.quorum(await ethers.provider.getBlockNumber() - 1)).toBigInt()).toEqual((await governor["quorumNumerator()"]()).toBigInt() * (await votingToken.totalSupply()).toBigInt() / 100n)
	})

	it("DAO Timelock is set up properly", async () => {
		expect(await (await timelock.getMinDelay()).toBigInt()).toEqual(timelockMinDelay)
		// the deployer has not renounced this role yet
		expect(await timelock.hasRole(await timelock.TIMELOCK_ADMIN_ROLE(), deployer.address)).toEqual(true)

		// TODO: why is this false?
		expect(await timelock.hasRole(await timelock.DEFAULT_ADMIN_ROLE(), deployer.address)).toEqual(false)

		// only the governor is a proposer
		expect(await timelock.hasRole(await timelock.PROPOSER_ROLE(), governor.address)).toEqual(true)
		expect(await timelock.hasRole(await timelock.PROPOSER_ROLE(), deployer.address)).toEqual(false)
		expect(await timelock.hasRole(await timelock.PROPOSER_ROLE(), nonMember.address)).toEqual(false)

		// several accounts can execute proposals
		expect(await timelock.hasRole(await timelock.EXECUTOR_ROLE(), deployer.address)).toEqual(false)
		expect(await timelock.hasRole(await timelock.EXECUTOR_ROLE(), nonMember.address)).toEqual(false)
		expect(await timelock.hasRole(await timelock.EXECUTOR_ROLE(), governor.address)).toEqual(true)
		expect(await timelock.hasRole(await timelock.EXECUTOR_ROLE(), members[0].address)).toEqual(true)
	})

	it("Adds direct voting power once members delegate on the token", async () => {
		// the governor tallies votes directly from the distributors
		await verifyVotes(false)

		await Promise.all(members.map(async (member, i) => {
			// get the voting token as the member
			const myVotingToken = await ethers.getContractAt("MyERC20Votes", votingToken.address, member);

			// delegation ensures that future token transfers will be considered for the user's voting power
			await myVotingToken.delegate(member.address)

			// fill an empty block (getPastVotes() relies on a previous block)
			await fillEmptyBlock();

			// a checkpoint has been saved for this user
			expect(await votingToken.numCheckpoints(member.address)).toBeGreaterThan(0)
			// the delegation has been recorded successfully
			expect(await votingToken.delegates(member.address)).toEqual(member.address)

			// a no-op to ensure a subsequent block (cannot getPastVotes() on the current block)
			await myVotingToken.transfer(deployer.address, 0)

			// the user now has voting power directly from the voting token contract
			expect((await votingToken.getVotes(member.address)).toBigInt()).toEqual(BigInt(getInitialTokenCount(i)))
			expect((await votingToken.getPastVotes(member.address, await ethers.provider.getBlockNumber() - 1)).toBigInt()).toEqual(BigInt(getInitialTokenCount(i)))
		}))

		await verifyVotes()
	})

	it("The DAO can send funds", async () => {
		// check that member token balances are zero
		await Promise.all(members.map(async member => {
			expect((await treasuryToken.balanceOf(member.address)).toBigInt()).toEqual(0n)
		}))

		// Propose that the DAO send some treasury tokens to each DAO member
		const amount = 100n

		const targets: string[] = []
		const values: number[] = []
		const calldatas: string[] = []

		const erc20Interface = new ethers.utils.Interface([
			{
				"inputs": [
					{
						"internalType": "address",
						"name": "to",
						"type": "address"
					},
					{
						"internalType": "uint256",
						"name": "amount",
						"type": "uint256"
					}
				],
				"name": "transfer",
				"outputs": [
					{
						"internalType": "bool",
						"name": "",
						"type": "bool"
					}
				],
				"stateMutability": "nonpayable",
				"type": "function"
			}
		])

		members.map((member) => {
			targets.push(treasuryToken.address)
			values.push(0)
			calldatas.push(erc20Interface.encodeFunctionData(erc20Interface.functions['transfer(address,uint256)'], [member.address, amount]))
		})

		const proposalDescription = 'plz can haz tokens plz'

		// the deployer cannot propose because the proposal threshold is > 0 and it does not hold any tokens
		await expect(
			governor.propose(
				targets,
				values,
				calldatas,
				proposalDescription
			)
		).rejects.toMatchObject({ message: expect.stringMatching(/Governor: proposer votes below proposal threshold/) })


		await executeProposal(targets, values, calldatas, proposalDescription)

		// check that member token balances did indeed go up
		await Promise.all(members.map(async member => {
			expect((await treasuryToken.balanceOf(member.address)).toBigInt()).toEqual(amount)
		}))
	})

	it("The owner can upgrade the DAO governor to an identical contract", async () => {
		const newImplementation = await GovernorFactory.deploy()
		await governor.upgradeTo(newImplementation.address)

		// ensure the governor is still tracking the right distributors

		expect(await governor.getVoteSources()).toEqual(distributors.map(d => d.address))

		// ensure voting still works
		await verifyVotes()
	})

	it("The governor can update its vote sources", async () => {
		// check initial distributors
		expect((await governor.getVoteSources()).length).toEqual(3)
		expect(await governor.getVoteSources()).toEqual(distributors.map(d => d.address))

		// we only need the one relevant section from the ABI
		const daoInterfaceFragment = new ethers.utils.Interface([
			{
				"inputs": [
					{
						"internalType": "contract IVotesUpgradeable[]",
						"name": "_voteSources",
						"type": "address[]"
					}
				],
				"name": "setVoteSources",
				"outputs": [],
				"stateMutability": "nonpayable",
				"type": "function"
			}
		])

		const targets = [governor.address]
		const values = [0]
		const calldatas = [
			daoInterfaceFragment.encodeFunctionData(
				daoInterfaceFragment.functions['setVoteSources(address[])'],
				[distributors.concat(newDistributors).map(d => d.address)]
			)
		]

		const proposalDescription = 'add more vote sources'

		// update the vote sources to include the new distributors
		await executeProposal(targets, values, calldatas, proposalDescription)

		// update our own records
		distributors.push(...newDistributors)

		// make sure voting power is initialized
		await initializeDistributors(newDistributors, members)

		expect((await governor.getVoteSources()).length).toEqual(5)
		expect(await governor.getVoteSources()).toEqual(distributors.map(d => d.address))

		// the new distributors are counted correctly toward voting
		await verifyVotes()
	})

	it("The governor cannot be initialized with random invalid vote sources", async () => {
		const newGovernor = await upgrades.deployProxy(GovernorFactory, undefined, { initializer: false }) as GovernorMultiSourceUpgradeable

		// DAO contract initialization requires the other DAO contract address - do it manually instead of within the deployProxy() call
		await expect(newGovernor.initialize(
			votingToken.address,
			timelock.address,
			// these are not valid distributors
			members.map(m => m.address)
		)).rejects.toMatchObject({ message: expect.stringMatching(/transaction may fail/) })
	})

	it("The owner cannot update vote sources", async () => {
		await expect(governor.setVoteSources(newDistributors.map(d => d.address))).rejects.toMatchObject({ message: expect.stringMatching(/Governor: onlyGovernance/) })
	})

	it("Members cannot update vote sources", async () => {
		const myGovernor = await ethers.getContractAt(
			"GovernorMultiSourceUpgradeable",
			governor.address,
			members[0]
		) as GovernorMultiSourceUpgradeable

		await expect(governor.setVoteSources(newDistributors.map(d => d.address))).rejects.toMatchObject({ message: expect.stringMatching(/Governor: onlyGovernance/) })
	})

	it("non-owners cannot upgrade the governor", async () => {
		// DAO member is not an owner
		const myGovernor = await ethers.getContractAt(
			"GovernorMultiSourceUpgradeable",
			governor.address,
			members[0]
		) as GovernorMultiSourceUpgradeable

		// TODO: the deployer can no longer do something stupid because it does not control the governor 
		await expect(myGovernor.upgradeTo(ethers.constants.AddressZero)).rejects.toMatchObject({ message: expect.stringMatching(/Ownable: caller is not the owner/) })
	})

	it("the deployer can renounce ownership of the governor", async () => {
		// remove the deployer as the governor owner
		await governor.renounceOwnership()

		expect(await governor.owner()).toEqual(ethers.constants.AddressZero)

		// TODO: the deployer can no longer do something stupid because it does not control the governor 
		expect(governor.upgradeTo(ethers.constants.AddressZero)).rejects.toMatchObject({ message: expect.stringMatching(/Ownable: caller is not the owner/) })
	})

	// TODO
	//   it("the deployer can rescue the DAO timelock from a broken governor while it remains an admin", async () => {
	// 	throw new Error('not tested')
	//   })

	// TODO
	//   it("The DAO can upgrade its own governor contract", async () => {
	// 	// governor.propose();
	// 	throw new Error('not implemented')
	//   })

	//   it("The DAO can rescue tokens accidentally sent to the governor instead of the timelock", async () => {
	// 	// governor.propose();
	// 	throw new Error('not implemented')
	//   })

	//   it("The DAO can rescue ETH accidentally sent to the governor instead of the timelock", async () => {
	// 	// governor.propose();
	// 	throw new Error('not implemented')
	//   })

	it("the deployer can renounce the admin role to the timelock", async () => {
		// remove the deployer as a timelock admin
		await timelock.renounceRole(
			await timelock.TIMELOCK_ADMIN_ROLE(),
			deployer.address
		)

		// all deployer admin roles should be renounced
		expect(await timelock.hasRole(await timelock.TIMELOCK_ADMIN_ROLE(), deployer.address)).toEqual(false)
		expect(await timelock.hasRole(await timelock.DEFAULT_ADMIN_ROLE(), deployer.address)).toEqual(false)

		// TODO: the deployer can no longer rescue the timelock
	})
})
