import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";
import { ethers } from 'hardhat'
import { GenericERC20, BasicDistributor, BasicDistributor__factory, Registry__factory, Registry } from "../../typechain-types";

jest.setTimeout(30000);

let registryFactory: Registry__factory
let registry: Registry
let deployer: SignerWithAddress
let owner: SignerWithAddress
let admin: SignerWithAddress
let rando: SignerWithAddress

const uri = "https://example.com"

const examples = {
	// random address
	'0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2': [
		// Distributor
		'0xa4d35362',
		// erc20 interface
		'0x36372b07'
	],
	// ftt token
	'0x50D1c9771902476076eCFc8B2A83Ad6b9355a4c9': [
		// erc20 interfaced
		'0x36372b07',
		// lol
		'0xdeadbeef',
		'0x1badf00d',
		'0x1337dead'
	]
}

describe("Registry", function () {
	beforeAll(async () => {
		[deployer, owner, admin, rando ] = await ethers.getSigners();
		registryFactory = await ethers.getContractFactory("Registry", deployer)
		registry = await registryFactory.deploy()
	})

	it('deployer can transfer ownership to owner', async () => {
		await registry.transferOwnership(owner.address)
		expect(await registry.owner()).toEqual(owner.address)
	})

	
	it('owner can add an admin', async () => {
		const myRegistry = await ethers.getContractAt("Registry", registry.address, owner) as Registry
		const role = await myRegistry.ADMIN_ROLE()

		await myRegistry.addAdmin(admin.address)

		// only the assigned admin has this role
		expect(await myRegistry.hasRole(role, admin.address)).toEqual(true)
		expect(await myRegistry.hasRole(role, deployer.address)).toEqual(false)
		expect(await myRegistry.hasRole(role, owner.address)).toEqual(false)
		expect(await myRegistry.hasRole(role, rando.address)).toEqual(false)
	})
	
	it('admin can register interfaces', async () => {
		const myRegistry = await ethers.getContractAt("Registry", registry.address, admin) as Registry

		for (let [address, interfaces] of Object.entries(examples)) {
			await myRegistry.register(address, interfaces)

			// the expected interfaces are now supported
			for (let i of interfaces) {
				expect(await myRegistry.targetSupportsInterface(address, i)).toEqual(true)
			}

			// an unregistered interfaces
			expect(await myRegistry.targetSupportsInterface(address, '0x12345678')).toEqual(false)
			// unregistered address
			expect(await myRegistry.targetSupportsInterface(rando.address, '0xdeadbeef')).toEqual(false)
		}
	})

	it('admin can unregister interfaces', async () => {
		const myRegistry = await ethers.getContractAt("Registry", registry.address, admin) as Registry

		for (let [address, interfaces] of Object.entries(examples)) {
			await myRegistry.unregister(address, interfaces)

			// the expected interfaces are now supported
			for (let i of interfaces) {
				expect(await myRegistry.targetSupportsInterface(address, i)).toEqual(false)
			}
		}
	})

	it('owner cannot register interfaces', async () => {
		const myRegistry = await ethers.getContractAt("Registry", registry.address, owner) as Registry

		for (let [address, interfaces] of Object.entries(examples)) {
			await expect(registry.register(address, interfaces)).rejects.toMatchObject({message: expect.stringMatching(/is missing role 0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775/)})
		}
	})
	
	it('random user cannot register interfaces', async () => {
		const myRegistry = await ethers.getContractAt("Registry", registry.address, rando) as Registry

		for (let [address, interfaces] of Object.entries(examples)) {
			await expect(registry.register(address, interfaces)).rejects.toMatchObject({message: expect.stringMatching(/is missing role 0xa49807205ce4d355092ef5a8a18f56e8913cf4a201fbe287825b095693c21775/)})
		}
	})
})
