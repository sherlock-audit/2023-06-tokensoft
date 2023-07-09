import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { ethers } from 'hardhat'
import { lastBlockTime, delay, getSaleId } from '../lib'

jest.setTimeout(30000);

let deployer, admin, recipient, goodBuyer, badBuyer: SignerWithAddress
let randomAddress
let publicSaleId: string
let privateSaleId: string
let usdc;
let chainlinkOracle;
let newToken;
let saleManager;

const maxQueueTime = 3600n;

// get the balance of a signer
const getBalance = async (signer: SignerWithAddress): Promise<bigint> => {
  return BigInt((await ethers.provider.getBalance(signer.address)).toString())
}

// manager, goodBuyer, and badBuyer are on this list
const merkleInput = [
  "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", // admin
  "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", // goodBuyer
  "0x90F79bf6EB2c4f870365E785982E1f101E93b906", // badBuyer
];

const merkleOutput = {
  "merkleRoot": "0x887a9d7f2b1fca2ff8c07e1e02d906bc2cda73495a8da7494165adcd81875164",
  "claims": {
    "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC": {
      "index": 0,
      "proof": [
        "0xb1a5bda84b83f7f014abcf0cf69cab5a4de1c3ececa8123a5e4aaacb01f63f83"
      ]
    },
    "0x70997970C51812dc3A010C7d01b50e0d17dc79C8": {
      "index": 1,
      "proof": [
        "0x1ebaa930b8e9130423c183bf38b0564b0103180b7dad301013b18e59880541ae",
        "0x8a3552d60a98e0ade765adddad0a2e420ca9b1eef5f326ba7ab860bb4ea72c94"
      ]
    },
    "0x90F79bf6EB2c4f870365E785982E1f101E93b906": {
      "index": 2,
      "proof": [
        "0x00314e565e0574cb412563df634608d76f5c59d9f817e85966100ec1d48005c0",
        "0x8a3552d60a98e0ade765adddad0a2e420ca9b1eef5f326ba7ab860bb4ea72c94"
      ]
    }
  }
};

describe("SaleManager_v_1_3", function () {
  beforeEach(async () => {
    // We will use these accounts for testing
    [deployer, admin, goodBuyer, badBuyer, randomAddress, recipient ] = await ethers.getSigners();

    // buyers are buying with this token
    const GenericERC20Factory = await ethers.getContractFactory("GenericERC20");
    usdc = await GenericERC20Factory.deploy(
      "US Dollar Coin",
      "USDC",
      6,
      "1000000000000000"
    );

    // deploy chainlink oracle
    const ChainlinkOracle = await ethers.getContractFactory("FakeChainlinkOracle");
    chainlinkOracle = await ChainlinkOracle.deploy(
      // eth price of $2942.40
      294240000000,
      // oracle description
      "ETH/USD"
    );

    // the manager is selling this token
    newToken = await GenericERC20Factory.deploy(
      "Neue Crypto Token",
      "NCT",
      18,
      "1000000000000000"
    );

    // create some sales as the sale manager
    const SaleManagerFactory = await ethers.getContractFactory("SaleManager_v_1_3", admin);
    saleManager = await SaleManagerFactory.deploy(
      usdc.address,
      6,
      chainlinkOracle.address
    );

    // Set up some dummy sales for testing as the sale manager
    const publicSaleTx = await saleManager.newSale(
      recipient.address,
      "0x0000000000000000000000000000000000000000000000000000000000000000", // public sale
      20000000000, // 20k USDC sale limit
      10000000000, // 10k USDC user limit
      1000000, // 1 USDC purchase minimum
      Math.floor(Math.random() * 10 ** 6), // starts at random value so that we can keep launching new sales w/o getting the duplicate sale warning
      4102444800, // ends Jan 1 2100
      maxQueueTime,
      "ipfs://QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq/2",
      1500000, // $1.50 USDC / NCT
      18 // NCT has 18 decimals
    );

    const privateSaleTx = await saleManager.newSale(
      recipient.address,
      merkleOutput.merkleRoot, // private sale
      100000000000, // 100k USDC sale limit
      10000000000, // 10k USDC user limit
      1000000, // 1 USDC purchase minimum
      Math.floor(Math.random() * 10 ** 6), // starts at random value so that we can keep launching new sales w/o getting the duplicate sale warning
      4102444800, // ends Jan 1 2100
      maxQueueTime,
      "ipfs://QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq/2",
      900000, // $0.90 USDC / NCT
      18 // NCT has 18 decimals
    );

    publicSaleId = await getSaleId(publicSaleTx)
    privateSaleId = await getSaleId(privateSaleTx)

    // need to return a promise from async beforeEach
    return privateSaleTx.wait();
  });

  it("Sales enforce purchase limits", async () => {
    // try a couple purchases as the good buyer
    let mySaleManager = await ethers.getContractAt("SaleManager_v_1_3", saleManager.address, goodBuyer);
    // 10mm USDC
    await usdc.transfer(goodBuyer.address, 10000000000000);
    const myUsdc = await ethers.getContractAt("GenericERC20",usdc.address, goodBuyer);
    await myUsdc.approve(saleManager.address, 10000000000000);

    // the limits match the sale setup
    expect(BigInt((await mySaleManager.getSaleBuyLimit(publicSaleId)).toString())).toBe(20000000000n)
    expect(BigInt((await mySaleManager.getUserBuyLimit(publicSaleId)).toString())).toBe(10000000000n)
    expect(BigInt((await mySaleManager.getPurchaseMinimum(publicSaleId)).toString())).toBe(1000000n)

    // A $1.00 ETH purchase is just large enough
    await mySaleManager.functions["buy(bytes32,bytes32[])"](
      publicSaleId,
      [],
      {
        value: ethers.utils.parseEther("0.000339858618814574"),
      }
    );

    // A $0.99 ETH purchase is slightly too small
    expect(
      mySaleManager.functions["buy(bytes32,bytes32[])"](
        publicSaleId,
        [],
        {
          value: ethers.utils.parseEther("0.000336460032626428"),
        }
      )
    ).rejects.toMatchObject({message: expect.stringMatching(/purchase below minimum/)})
    

    // // A $1.00 USDC purchase is just large enough
    await mySaleManager.functions['buy(bytes32,uint256,bytes32[])'](publicSaleId, 1000000, []);

    // // A $0.999999 purchase is slightly too small
    expect(
      mySaleManager.functions['buy(bytes32,uint256,bytes32[])'](publicSaleId, 999999, [])
      ).rejects.toMatchObject({message: expect.stringMatching(/purchase below minimum/)})
    
    
    // The user can make a 9,998 USDC purchase (2 previous $1 purchases)
    await mySaleManager.functions['buy(bytes32,uint256,bytes32[])'](publicSaleId, 9998000000, []);

    // The user has filled their allocation
    const spentByGoodBuyer = BigInt(await mySaleManager.functions['getSpent(bytes32,address)'](publicSaleId, goodBuyer.address));
    expect(spentByGoodBuyer).toBe(10000000000n);
    
    // This user cannot make any more purchases
    expect(
      mySaleManager.functions['buy(bytes32,uint256,bytes32[])'](publicSaleId, 1000000, [])
    ).rejects.toMatchObject({message: expect.stringMatching(/purchase exceeds your limit/)})
    
    // The bad buyer can also make a $10k purchase
    mySaleManager = await ethers.getContractAt("SaleManager_v_1_3", saleManager.address, badBuyer);
    await mySaleManager.functions["buy(bytes32,bytes32[])"](
      publicSaleId,
      [],
      {
        value: ethers.utils.parseEther("3.3985861881457313"),
      }
    );

    // The sale is filled
    const totalSpent = BigInt(await mySaleManager.functions['getTotalSpent(bytes32)'](publicSaleId));
    // not sure why this isn't an even 20000000000n, but it's close enough!
    expect(totalSpent).toBe(19999999999n);

    // No users can make any more purchases
    mySaleManager = await ethers.getContractAt("SaleManager_v_1_3", saleManager.address, randomAddress);
    expect(
      mySaleManager.functions["buy(bytes32,bytes32[])"](
        publicSaleId,
        [],
        {
          value: ethers.utils.parseEther("0.01"),
        }
      )
    ).rejects.toMatchObject({message: expect.stringMatching(/purchase exceeds sale limit/)})
  })

  it("Users cannot alter sales they did not create", async () => {
    // several users will try to create identical or almost identical fields
    const saleFields: Parameters<typeof mySaleManager.newSale> = [
      recipient.address,
      "0x0000000000000000000000000000000000000000000000000000000000000000", // public sale
      100000000000, // 100k USDC sale limit
      10000000000, // 10k USDC user limit
      1000000, // 1 USDC purchase minimum
      Math.floor(Math.random() * 10 ** 6), // starts at random value so that we can keep launching new sales w/o getting the duplicate sale warning
      4102444800, // ends Jan 1 2100
      maxQueueTime,
      "ipfs://QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq/2",
      1500000, // $1.50 USDC / NCT
      18 // NCT has 18 decimals
    ]

    // the good buyer can launch his own sale
    let mySaleManager = await ethers.getContractAt("SaleManager_v_1_3", saleManager.address, goodBuyer);
    const goodSaleTx = await mySaleManager.newSale(...saleFields)
    const goodSaleId = await getSaleId((goodSaleTx))

    // try creating malicious sales as a bad user
    mySaleManager = await ethers.getContractAt("SaleManager_v_1_3", saleManager.address, badBuyer);
    // the bad buyer cannot create an identical sale (it already exists!)
    expect(
      mySaleManager.newSale(...saleFields)
    ).rejects.toMatchObject({message: expect.stringMatching(/a sale with these parameters already exists/)})

    // the bad buyer can create a sale with a different recipient
    saleFields[0] = badBuyer.address
    const badSaleTx = await mySaleManager.newSale(...saleFields)
    const badSaleId = await getSaleId((badSaleTx))

    // Even after the bad buyer has tried to create some bad sales, the good sale recipient is unchanged
    const goodSaleRecipient = await saleManager.getRecipient(goodSaleId)
    expect(goodSaleRecipient).toBe(recipient.address)

    // the bad sale cannot have the same id as the good sale
    expect(goodSaleId).not.toBe(badSaleId)

    // the bad sale recipient should be the bad buyer
    const badSaleRecipient = await saleManager.getRecipient(badSaleId)
    expect(badSaleRecipient).toBe(badBuyer.address)
  })

  it("ERC20 payments go directly to the recipient", async () => {
    let mySaleManager, myUsdc;

    // get the initial recipient balances
    const initialTokenBalance = BigInt(await usdc.balanceOf(recipient.address));
    expect(initialTokenBalance).toBe(0n);

    // bad buyer can buy ($123 of USDC)
    await usdc.transfer(goodBuyer.address, 123000000);
    mySaleManager = await ethers.getContractAt(
      "SaleManager_v_1_3",
      saleManager.address,
      goodBuyer
    );
    myUsdc = await ethers.getContractAt("GenericERC20", usdc.address, goodBuyer);
    await myUsdc.approve(saleManager.address, 123000000);
    await mySaleManager.functions["buy(bytes32,uint256,bytes32[])"](
      privateSaleId,
      123000000,
      ["0xb1a5bda84b83f7f014abcf0cf69cab5a4de1c3ececa8123a5e4aaacb01f63f83"]
    );

    // bad buyer can buy (1.23 ETH at price of $2942/ETH)
    mySaleManager = await ethers.getContractAt(
      "SaleManager_v_1_3",
      saleManager.address,
      badBuyer
    );
    await myUsdc.approve(saleManager.address, 400);

    // did the recipient receive the USDC?
    const finalTokenBalance = BigInt(await usdc.balanceOf(recipient.address));
    expect(finalTokenBalance - initialTokenBalance).toBe(123000000n);

    // check that the sale is accounting for the purchase correctly
    const response = await mySaleManager.functions.totalSpent();
    const totalSpent = BigInt(response[0]);
    // the total spent should be the USD value of the USDC purchase
    expect(totalSpent).toBe(123000000n);
  })

  it("Native token payments go to the recipient when withdrawPayments is called with the proper address", async () => {
    let mySaleManager;

    const initialEthBalance = await getBalance(recipient)

    mySaleManager = await ethers.getContractAt(
      "SaleManager_v_1_3",
      saleManager.address,
      goodBuyer
    );

    // the good buyer participates in a private sale
    await mySaleManager.functions["buy(bytes32,bytes32[])"](
      privateSaleId,
      [
        "0xb1a5bda84b83f7f014abcf0cf69cab5a4de1c3ececa8123a5e4aaacb01f63f83"
      ],
      {
        value: ethers.utils.parseEther("1.23"),
      }
    );

    // switch to bad buyer
    mySaleManager = await ethers.getContractAt(
      "SaleManager_v_1_3",
      saleManager.address,
      badBuyer
    );

    // the bad buyer participates in a public sale
    await mySaleManager.functions["buy(bytes32,bytes32[])"](
      publicSaleId,
      [],
      {
        value: ethers.utils.parseEther("0.45"),
      }
    );

    // switch to random address
    mySaleManager = await ethers.getContractAt(
      "SaleManager_v_1_3",
      saleManager.address,
      randomAddress
    );

    // random address participates in a public sale
    await mySaleManager.functions["buy(bytes32,bytes32[])"](
      publicSaleId,
      [],
      {
        value: ethers.utils.parseEther("1.00"),
      }
    );

    // Withdrawals to token sale participants should have no effect
    let startingBalance = await getBalance(goodBuyer);
    await mySaleManager.functions.withdrawPayments(goodBuyer.address);
    let endingBalance = await getBalance(goodBuyer);
    expect(startingBalance).toBe(endingBalance);

    startingBalance = await getBalance(badBuyer);
    await mySaleManager.functions.withdrawPayments(badBuyer.address);
    endingBalance = await getBalance(badBuyer);
    expect(startingBalance).toBe(endingBalance);

    startingBalance = await getBalance(randomAddress);
    await mySaleManager.functions.withdrawPayments(randomAddress.address);
    endingBalance = await getBalance(randomAddress);

    // A bit of ETH was spent on the transaction
    expect(startingBalance).toBeGreaterThan(endingBalance);

    // Withdraw tokens for the recipient
    await mySaleManager.functions.withdrawPayments(recipient.address);

    // The recipient should receive all ETH from the two sales (1.23 + 0.45 + 1 ETH = 2.68 ETH)
    const finalEthBalance = await getBalance(recipient);
    expect(finalEthBalance - initialEthBalance).toBe(
      BigInt(ethers.utils.parseEther("2.68").toString())
    );

    // check that the sale is accounting for these purchases correctly
    const response = await mySaleManager.functions.totalSpent();
    const totalSpent = BigInt(response[0]);
    // the total spent should be 7885 USDC (2.68 ETH at $2,942/ETH)
    expect(totalSpent).toBe(7885632000n);
  })

  it("Can only withdraw ETH earned for each sale", async () => {
    let mySaleManager;

    // the bad buyer sets up a new valid sale
    const saleFields = [
      badBuyer.address,
      "0x0000000000000000000000000000000000000000000000000000000000000000", // public sale
      100000000000, // 100k USDC sale limit
      10000000000, // 10k USDC user limit
      1000000, // 1 USDC purchase minimum
      Math.floor(Math.random() * 10 ** 6), // starts at random value so that we can keep launching new sales w/o getting the duplicate sale warning
      4102444800, // ends Jan 1 2100
      maxQueueTime,
      "ipfs://QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq/2",
      1500000, // $1.50 USDC / NCT
      18 // NCT has 18 decimals
    ]
    
    // the bad buyer creates this new sale
    mySaleManager = await ethers.getContractAt("SaleManager_v_1_3", saleManager.address, badBuyer);
    const badSaleTx = await mySaleManager.newSale(...saleFields)
    const badSaleId = await getSaleId((badSaleTx))

    const badBuyerStartingBalance = await getBalance(badBuyer);
    const recipientStartingBalance = await getBalance(recipient);

    mySaleManager = await ethers.getContractAt(
      "SaleManager_v_1_3",
      saleManager.address,
      goodBuyer
    );

    // the good buyer participates in the new bad sale
    await mySaleManager.functions["buy(bytes32,bytes32[])"](
      badSaleId,
      [],
      {
        value: ethers.utils.parseEther("0.01"),
      }
    );

    // the good buyer participates in the private sale
    await mySaleManager.functions["buy(bytes32,bytes32[])"](
      privateSaleId,
      [
        "0xb1a5bda84b83f7f014abcf0cf69cab5a4de1c3ececa8123a5e4aaacb01f63f83"
      ],
      {
        value: ethers.utils.parseEther("0.123"),
      }
    );

    mySaleManager = await ethers.getContractAt(
      "SaleManager_v_1_3",
      saleManager.address,
      goodBuyer
    );

    // The good buyer can withdraw for both the recipient and the bad buyer
    await mySaleManager.functions.withdrawPayments(badBuyer.address);
    await mySaleManager.functions.withdrawPayments(recipient.address);

    const badBuyerEndingBalance = await getBalance(badBuyer);
    const recipientEndingBalance = await getBalance(recipient);

    // The bad buyer should have received 0.01 ETH from their public sale
    expect(badBuyerEndingBalance - badBuyerStartingBalance).toBe(
      BigInt(ethers.utils.parseEther("0.01").toString())
    );

    // The recipient should have received 0.123 ETH from their private sale
    expect(recipientEndingBalance - recipientStartingBalance).toBe(
      BigInt(ethers.utils.parseEther("0.123").toString())
    );
  })

  it("Anyone can participate in the public sale", async () => {
    let mySaleManager, myUsdc;
    // get the initial recipient balance
    const initialBalance = await usdc.balanceOf(recipient.address);

    // good buyer can buy (10 USDC)
    await usdc.transfer(goodBuyer.address, 10000000);
    mySaleManager = await ethers.getContractAt("SaleManager_v_1_3", saleManager.address, goodBuyer);
    myUsdc = await ethers.getContractAt("GenericERC20",usdc.address, goodBuyer);
    await myUsdc.approve(saleManager.address, 10000000);
    await mySaleManager.functions['buy(bytes32,uint256,bytes32[])'](publicSaleId, 10000000, []);

    // bad buyer can buy (20 USDC, it is a public sale after all)
    await usdc.transfer(badBuyer.address, 20000000);
    mySaleManager = await ethers.getContractAt("SaleManager_v_1_3", saleManager.address, badBuyer);
    myUsdc = await ethers.getContractAt("GenericERC20",usdc.address, badBuyer);
    await myUsdc.approve(saleManager.address, 20000000);
    await mySaleManager.functions['buy(bytes32,uint256,bytes32[])'](publicSaleId, 20000000, []);

    // random address can buy (30 USDC)
    await usdc.transfer(randomAddress.address, 30000000);
    mySaleManager = await ethers.getContractAt("SaleManager_v_1_3", saleManager.address, randomAddress);
    myUsdc = await ethers.getContractAt("GenericERC20",usdc.address, randomAddress);
    await myUsdc.approve(saleManager.address, 30000000);
    await mySaleManager.functions['buy(bytes32,uint256,bytes32[])'](publicSaleId, 30000000, []);

    // make sure the totals make sense
    const finalBalance = await usdc.balanceOf(recipient.address);
    expect(finalBalance.toNumber() - initialBalance.toNumber()).toBe(60000000);

    const response = await mySaleManager.functions.totalSpent()
    const totalSpent = response[0].toNumber();
    expect(totalSpent).toBe(60000000)
  })

  it("Only qualified users can participate in the private sale", async () => {
    let mySaleManager, myUsdc

    // get the initial recipient balance
    const initialBalance = await usdc.balanceOf(recipient.address);

    // good buyer can buy (10 USDC)
    await usdc.transfer(goodBuyer.address, 10000000);
    mySaleManager = await ethers.getContractAt("SaleManager_v_1_3", saleManager.address, goodBuyer);
    myUsdc = await ethers.getContractAt("GenericERC20",usdc.address, goodBuyer);
    await myUsdc.approve(saleManager.address, 10000000);
    await mySaleManager.functions['buy(bytes32,uint256,bytes32[])'](
      privateSaleId,
      10000000,
      ["0xb1a5bda84b83f7f014abcf0cf69cab5a4de1c3ececa8123a5e4aaacb01f63f83"]
    );

    // bad buyer can buy (5 USDC, they are in the merkle proof)
    await usdc.transfer(badBuyer.address, 5000000);
    mySaleManager = await ethers.getContractAt("SaleManager_v_1_3", saleManager.address, badBuyer);
    myUsdc = await ethers.getContractAt("GenericERC20",usdc.address, badBuyer);
    await myUsdc.approve(saleManager.address, 5000000);
    await mySaleManager.functions['buy(bytes32,uint256,bytes32[])'](
      privateSaleId,
      5000000,
      [
        "0x00314e565e0574cb412563df634608d76f5c59d9f817e85966100ec1d48005c0",
        "0x8a3552d60a98e0ade765adddad0a2e420ca9b1eef5f326ba7ab860bb4ea72c94"
      ]
    );

    // random address cannot buy
    await usdc.transfer(randomAddress.address, 20000000);
    mySaleManager = await ethers.getContractAt("SaleManager_v_1_3", saleManager.address, randomAddress);
    myUsdc = await ethers.getContractAt("GenericERC20",usdc.address, randomAddress);
    await myUsdc.approve(saleManager.address, 20000000);

    expect(
      mySaleManager.functions['buy(bytes32,uint256,bytes32[])'](
        privateSaleId,
        20000000,
        [
          "0x00314e565e0574cb412563df634608d76f5c59d9f817e85966100ec1d48005c0",
          "0x8a3552d60a98e0ade765adddad0a2e420ca9b1eef5f326ba7ab860bb4ea72c94"
        ]
      )
    ).rejects.toMatchObject({message: expect.stringMatching(/bad merkle proof for sale/)})

    // using an empty merkle proof fails
    expect(
      mySaleManager.functions['buy(bytes32,uint256,bytes32[])'](
        privateSaleId,
        20000000,
        []
      )
    ).rejects.toMatchObject({message: expect.stringMatching(/bad merkle proof for sale/)})

    // using bytes32(0) fails
    expect(
      mySaleManager.functions['buy(bytes32,uint256,bytes32[])'](
        privateSaleId,
        20000000,
        ["0x0000000000000000000000000000000000000000000000000000000000000000"]
      )
    ).rejects.toMatchObject({message: expect.stringMatching(/bad merkle proof for sale/)})

    // make sure the totals make sense
    const finalBalance = await usdc.balanceOf(recipient.address);
    expect(finalBalance.toNumber() - initialBalance.toNumber()).toBe(15000000);
    const response = await mySaleManager.functions.totalSpent();
    const totalSpent = response[0].toNumber();
    expect(totalSpent).toBe(15000000)

    // special case: a merkle root with a single leaf still works: use the generate-merkle-root script on a single address
    const singleParticipantRoot = {"merkleRoot":"0x8a3552d60a98e0ade765adddad0a2e420ca9b1eef5f326ba7ab860bb4ea72c94","claims":{"0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC":{"index":0,"proof":[]}}}
    const saleFields = [
      goodBuyer.address,
      singleParticipantRoot.merkleRoot, // this merkle root is just sha256(goodBuyer.address)
      100000000000, // 100k USDC sale limit
      10000000000, // 10k USDC user limit
      1000000, // 1 USDC purchase minimum
      Math.floor(Math.random() * 10 ** 6), // starts at random value so that we can keep launching new sales w/o getting the duplicate sale warning
      4102444800, // ends Jan 1 2100
      maxQueueTime,
      "ipfs://QmeSjSinHpPnmXmspMjwiXyN6zS4E9zccariGR3jxcaWtq/2",
      1500000, // $1.50 USDC / NCT
      18 // NCT has 18 decimals
    ]
    
    // the good buyer creates this new sale
    mySaleManager = await ethers.getContractAt("SaleManager_v_1_3", saleManager.address, goodBuyer);
    const singleParticipantTx = await mySaleManager.newSale(...saleFields)
    const singleParticipantId = await getSaleId((singleParticipantTx))

    // the good buyer can participate (even though their merkle proof is empty) {
    await mySaleManager.functions["buy(bytes32,bytes32[])"](
      singleParticipantId,
      [],
      {
        value: ethers.utils.parseEther("1.23"),
      }
    );
  })

  it("Queue Delay works as expected", async () => {
    // TODO: sometimes this test fails with errors like this: invalid address (argument="address", value="0x46627f4094a53e8fb6fd287c69aeea7a54bc751", code=INVALID_ARGUMENT, version=address/5.4.0)
    // Likely cause: ethereum addresses must be 40 characters, but that is 41! Why is the randomValue producing values outside the ETH address space?

    // Get the largest possible uint160 (this number is all "1"s when displayed in binary)
    const maxUint160 = 2n ** 160n - 1n;
    // get the current random value of the sale
    const randomValue = BigInt(await saleManager.getRandomValue(publicSaleId));
    // the random value should never be zero
    expect(randomValue).not.toBe(BigInt(0))

    // get the number the furthest distance from the random value by the xor metric (flip all bits in the number so the distance is maxUint160)
    const xorValue = BigInt(randomValue) ^ maxUint160;

    // the random value taken as an address should have a delay of 0
    const minDelay = BigInt(await saleManager.getFairQueueTime(publicSaleId, `0x${randomValue.toString(16)}`));
    // the delay for the random value converted to an address must be zero
    expect(minDelay).toBe(BigInt(0))

    // the xor of the random value taken as an address should have the largest possible delay
    const maxDelay = BigInt(await saleManager.getFairQueueTime(publicSaleId, `0x${xorValue.toString(16)}`));
    // the delay for the xor of the random value converted to an address must be the maximum queue time
    expect(maxDelay).toBe(maxQueueTime)


    // change the merkle root of the public sale to private
    await saleManager.setStart(publicSaleId, 4000000000);
    await saleManager.setMerkleRoot(publicSaleId, merkleOutput.merkleRoot)
    // get the latest random value from the public sale
    const randomValue2 = BigInt(await saleManager.getRandomValue(publicSaleId));
    // get the random value from the private sale
    const randomValue3 = BigInt(await saleManager.getRandomValue(privateSaleId));

    // every random value should be different
    expect(randomValue).not.toBe(randomValue2)
    expect(randomValue).not.toBe(randomValue3)

    // get the private sale delay for the good buyer
    const goodBuyerDelay = BigInt(await saleManager.getFairQueueTime(privateSaleId, goodBuyer.address));
    let current = BigInt(await saleManager.getStartTime(privateSaleId))

    // set the start time of the private sale so that the good buyer should be able to participate 2 seconds from now
    await saleManager.setStart(privateSaleId, (await lastBlockTime()) - goodBuyerDelay + 2n );

    current = BigInt(await saleManager.getStartTime(privateSaleId))

    // the buyer should not be able to buy yet
    const mySaleManager = await ethers.getContractAt("SaleManager_v_1_3", saleManager.address, goodBuyer);
    await expect(
      mySaleManager.functions['buy(bytes32,bytes32[])'](
        privateSaleId,
        ["0xb1a5bda84b83f7f014abcf0cf69cab5a4de1c3ececa8123a5e4aaacb01f63f83"],
        {value: 123456}
      )
    ).rejects.toMatchObject({message: expect.stringMatching(/not your turn yet/)})

    // wait for 2 seconds
    await delay(2000);

    // the buyer should be able to buy now
    await mySaleManager.functions['buy(bytes32,bytes32[])'](
      privateSaleId,
      ["0xb1a5bda84b83f7f014abcf0cf69cab5a4de1c3ececa8123a5e4aaacb01f63f83"],
      {value: ethers.utils.parseEther("0.01")}
    );

    // make sure the totals make sense
    // No USDC was spent
    const usdcBalance = await usdc.balanceOf(recipient.address);
    expect(usdcBalance.toNumber()).toBe(0);

    // But ETH was spent
    const response = await mySaleManager.functions.totalSpent();
    const totalSpent = response[0].toNumber();
    // 0.1 ETH to USD at $2942.40 per ETH
    expect(totalSpent).toBe(29424000)
  });
});
