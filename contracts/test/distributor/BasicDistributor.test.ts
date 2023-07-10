import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { BigNumber } from "ethers";
import { ethers } from 'hardhat'
import { GenericERC20, BasicDistributor, BasicDistributor__factory } from "../../typechain-types";

jest.setTimeout(30000);

let DistributorFactory: BasicDistributor__factory
let distributor: BasicDistributor
let newToken: GenericERC20
let deployer: SignerWithAddress
let b1: SignerWithAddress;
let b2: SignerWithAddress;
let b3: SignerWithAddress;
let nonBeneficiary: SignerWithAddress;
let sweepRecipient: SignerWithAddress;
let beneficiaries: SignerWithAddress[]
let amounts: bigint[]

const uri = "https://example.com"

describe("BasicDistributor", function () {
  beforeAll(async () => {
    [deployer, b1, b2, b3, nonBeneficiary, sweepRecipient ] = await ethers.getSigners();

    beneficiaries = [
      b1, b2, b3
    ]
    
    amounts = [
      1000n, 2000n, 3000n
    ]

    // deploy a distributor that is done vesting all tranches
    DistributorFactory = await ethers.getContractFactory("BasicDistributor", deployer);

    // a token to claim
    const GenericERC20Factory = await ethers.getContractFactory("GenericERC20", deployer);
    newToken = await GenericERC20Factory.deploy(
      "Neue Crypto Token",
      "NCT",
      18,
      // 1B tokens
      // (10n ** 9n * 10n ** 18n).toString()
      '1000000000000000000000000000'
    ) as GenericERC20

    // deploy another distributor with a distribution schedule that is in the past
    distributor = await DistributorFactory.deploy(
      newToken.address,
      amounts.reduce((a,b) => a+b),
      uri,
      0n,
      beneficiaries.map(b => b.address),
      amounts
    );
    
    // transfer tokens to the distributor
    await newToken.transfer(distributor.address, await distributor.total())
  });

  it("Metadata is correct", async () => {
    expect(await distributor.NAME()).toEqual("BasicDistributor")
    expect(await distributor.VERSION() >= BigNumber.from(1))
    expect(await distributor.uri()).toEqual(uri)
  })

  it("Initial setup matches sale correctly", async () => {
    expect(await distributor.token()).toEqual(newToken.address)

    for (let [i, beneficiary] of beneficiaries.entries()) {
      const distributionRecord = await distributor.getDistributionRecord(beneficiary.address)

      // claims are initialized in the constructor!
      expect(distributionRecord.initialized).toEqual(true)
  
      // the total should match amounts
      expect(distributionRecord.total.toBigInt()).toEqual(amounts[i])

      // nothing has been claimed yet
      expect(distributionRecord.claimed.toBigInt()).toEqual(0n)

      // the beneficiary does not yet hold tokens to claim
      expect((await newToken.balanceOf(beneficiary.address)).toBigInt()).toEqual(0n)
  
      // the distributor does hold tokens
      expect((await newToken.balanceOf(distributor.address)).toBigInt()).toEqual(amounts.reduce((a,b) => a+b))
    }
  })

  it("Can set sweep recipient", async () => {
    expect(await distributor.getSweepRecipient()).toEqual(deployer.address)
    await distributor.setSweepRecipient(sweepRecipient.address);
    expect(await distributor.getSweepRecipient()).toEqual(sweepRecipient.address)
  })

  it("All beneficiaries can claim", async () => {
    for (let [i, beneficiary] of beneficiaries.entries()) {
      await distributor.claim(beneficiary.address)

      let distributionRecord = await distributor.getDistributionRecord(beneficiary.address)
      // only half of the tokens are claimable right now
      expect(distributionRecord.total.toBigInt()).toEqual(amounts[i])
      expect(distributionRecord.claimed.toBigInt()).toEqual(amounts[i])
      expect(distributionRecord.initialized).toEqual(true)
      expect((await newToken.balanceOf(beneficiary.address)).toBigInt()).toEqual(amounts[i])

      // the user cannot claim again for now
      await expect(
        distributor.claim(beneficiary.address)
      ).rejects.toMatchObject(
        {message: expect.stringMatching(/no more tokens claimable right now/)}
      )
    }
    // no tokens are left in the distributor
    expect((await newToken.balanceOf(distributor.address)).toBigInt()).toEqual(0n)
  })

  it("non-beneficiaries cannot claim", async () => {
    let distributionRecord = await distributor.getDistributionRecord(nonBeneficiary.address)
    // nothing to distribute
    expect(distributionRecord.total.toBigInt()).toEqual(0n)
    // nothing claimed
    expect(distributionRecord.claimed.toBigInt()).toEqual(0n)
    // not initialized
    expect(distributionRecord.initialized).toEqual(false)
    // user holds no tokens
    expect((await newToken.balanceOf(nonBeneficiary.address)).toBigInt()).toEqual(0n)

    // The user cannot claim because they did not make any purchases
    await expect(
      distributor.claim(nonBeneficiary.address)
    ).rejects.toMatchObject({message: expect.stringMatching(/Distributor: claim not initialized/)})
  });

  // TODO: cannot set up invalid distributor tranches
  it("reverts on misconfiguration during deployment", async () => {
    // Must vest all tokens
   await expect(
      DistributorFactory.deploy(
        newToken.address,
        // the total is off by one
        amounts.reduce((a,b) => a+b) + 1n,
        uri,
        0n,
        beneficiaries.map(b => b.address),
        amounts
      )
    // it reverts, I am not sure why the string matching doesn't work!
    ).rejects.toBeTruthy() 

    // Lengths of recipients and amounts must match
    await expect(
      DistributorFactory.deploy(
        newToken.address,
        amounts.reduce((a,b) => a+b),
        uri,
        0n, // vote factor
        beneficiaries.map(b => b.address),
        // wrong number of amounts
        [1n, 2n, 3n, 4n],
      )
    ).rejects.toMatchObject(
      {message: expect.stringMatching(/_recipients, _amounts different lengths/)}
    )
  })

  it('total to distribute must be > 0', async () => {
    await expect(
      DistributorFactory.deploy(
        newToken.address,
        0n,
        uri,
        0n,
        beneficiaries.map(b => b.address),
        [0n, 0n, 0n]
      )
    ).rejects.toMatchObject(
      {message: expect.stringMatching(/Distributor: total is 0/)}
    )
  })

  it('can support a large number of claims', async () => {

    const bigAmounts: bigint[] = []
    const bigAddresses = ["0xE5d1c07Df2f05Db764355635D659ca844Ffe9FE3","0x0D743bcF9502b3cDf94de553aA5B9ed7E1db6A8a","0x121D9a947d3fcb1eD943dF734892160881406BD6","0x1Bd5E28871745bBD349d9FB63fE8CD902Dd57832","0xd8fFC35436e40B6adCC480f3047Dc43FAd0B040c","0x2744BdE69dDB7b5da221De58C2b117Fb8c23ebB6","0xdED5E9b7D083FC7e736001598065561C4EC29653","0x4B000D399494FE01369A8fA9454ced0C10C8B33b","0xe0c828DbD41717dbB0c7E5f1204f3164c3045B8d","0xD229A94f44CAD718f1F31b49E71827437c57E027","0x6c55d6064CaCb3D373f0b595AA74b5FE035716D9","0x9bB99A28f2330d8f414fD472993a6921623DE153","0x9c0D2bB215E32FDb18bf33540677F913e399709c","0x9769B81eB1fB8F9E6525B08FAB824350aE4EBC6D","0x4E3fB2Ea9F96b239E2e662164e3c1fa36ccf19e5","0x4ec379ac8777CA103B550abDC5e78236e3cec6fC","0x81D6EBB60Fd1C53115e2e241f064Adb610A6e349","0x45A3Aa669E8c846524D184e01aa6e52B70015e25","0x7C390F90aFF56ED74eA80ac2abDF1c02c610B5c8","0x6C75F80CFA99F17A1637B24F9FC9418a5aE9b11c","0xa7810B27957D3F5D50d9E7EdB7123b2Ce3cE9385","0x5E78a15cECF368f28924a8E7370770f59c4D2a23","0xcdfc6Daa7E970D98f1756fBd8cf6a80bee8038E2","0x65Cf22c3ac22B790118cC5408514068f9cD5aD44","0xf705B6de4B02aE221F9BA53f9FCC6e495b036129","0x9bdC210DAa07174B4DF9A1B8c74618f676195a1d","0x9847726b65DEeEFe82B3A6775820d945bE66A395","0x40fa47350E4c52Aa6b89bD8bd36CD02dc87EF969","0xF55253B37dD636f975ea968cbE292384843Cf479","0x988efCa1Cf782Fd4bB0c0110eC66Af7d88bF12b2","0x595Bc3354868D1abDD42F9eA5609767197973A6F","0x5E246E1EE56464dd72060cf49F906A0340A53C11","0xC9954df9A63dFbeAa240A286611b1DF9523781e3","0xE1a6482E6cb95faF955B5aDBeC28269E95A5f52e","0x2BB135E6A72764C34a4F30c8f343e20d7c64f534","0xd7979bd76a01dBB871dD6968DE7d5A6F4e07AE33","0x05280cfa410A645A05D53F7CB82b22e43e75cd0e","0xd6F6431e30200F2e5bE43Fe57e1eD0C85cfeFe9f","0x0392ab11a185fD005D319Df4AC8eA40742d7058b","0x9AD5617193388c36EB7Da64c1232240D59bc2b79","0x8DcE98A4Ca5Bb57083D7DA412a211904a1c3591f","0xac91BdE1ed99CeDc24f99bff980f32511337f3Cb","0x909D9000f1F421885ae96A5dcE3BbfE36a76dbe0","0xdB13B0df72bEaad9EF86630f9026cffDd85bEe7a","0x4A38C610F33efEA707D44fe88AE50F56A583150d","0x43f1d3617D59E068408ca6824b0035B79fa99710","0xC354AB905b623B76C9b807E38734C082B8711341","0xB0AF8e61eEd131FE1D4ef9A90BC6BF3C6Cd5B7AF","0xe41B9dF74e5096480edB35F941129977e97fc68e","0x39b827529733998b77C75C9CB2010b215C6509B6","0x7c20a8ae992Ea18c826dcE28D2f06594AE00bE21","0x4748ef9Bc80Ad623c8015B7bF2BD974D693dDeF0","0xe24D89C470e61cd2A112797A6a470668adaD0718","0xCfa763f81270f5a21647eBB310dcA32868c089eF","0xD3F502ce56De6982b69aA4554fc315B4c694CC6c","0x208B664dD31598b748A3E4B79505f988eb38e6EF","0xDD7A36936Be1D48A8828311e58555cfeDBa31A8A","0x5f9981d149aB5eaaa21E3eE1B0b34B4f25a09839","0x9434898D3C781011Ffb609630D503474DAE84E73","0x46f92c6FB3345097fa2849eB4fad36d8FdF3Fd78","0x5Fe4e283FaCf531a19E20e4a7A2678d4A68609bC","0x1c9dcDfFdCf7136448345Dfee4c3b480D2223F94","0x6d8Dd217cbF8Ab42F3AD02389682680974109F3C","0x932D98751CB10D95735724A7f5465Aa2Bdec46b2","0xde1ee20548947BeB8a23E9ee7731bb438a3876C2","0xF373273DD6C660A89a25A806FB2cdd51b9336151","0x11dE0F1BBa51A896297492A6F855f8a225b52d6c","0x0336154A40d034dD2e301a1054490a8dF5A482eB","0x5b516Aa9Cb91114D518A11a2c8e792F09B976577","0xDA509DaEAF7538E44Ac718E4195B461076C04d3c","0xEa0927302F9EcF84E15838197c216051a177e7D4","0x312D8c0c09Ef7851B99BcbEd82E1b29D6fAECfaa","0x1B328A2742B5c32DE499D2b3e5aeD3bEcc222483","0x605d68CBE8FEdd71c4bafB4a25A0A9C43354204d","0xD8DFde47b5086C2fe4898D58C233fe882E02Cd16","0x73973d46fE6c5F65943148C3AE50F81729D88C15","0x62Ae5a883cACDeeD1aD4F3846D7C368479CeA7E8","0x932F90667C99Ecbd27CCA2aD44aeB49f3C8f36BD","0x348E185350c332d3076732a19Cca40b0cc6F0BAf","0xD1580e21eC1D32Ce93831e790070BcF9ae21708d","0xD440AAf9043Cf7C412bbb7A3AEEB6555eef855d1","0x13a27deAf7416f33A7a7a6A64996c7C14a0059E5","0xb43ca4f3Fa69E98e44bf2C69D1f6aD7842A7f60f","0xef83b1A9b40A280E972430816A7D060Bf2cefc24","0x3f474EF4Bb4ab6b75E9c451531484d8B81ce62eE","0x3202b27AeBc27370fad6702aF55b8Dc2dC720895","0xdA22fb2902BcF12560c92Bd11d60663e36661C54","0xC7f306d7dE51E49C42819F2e9f0d094a76a47693","0x09E5bB21D6b6fE557D68d2ebcBa20F57CD6e0E05","0xD5ef8CEfdb22e585717C16E4b0F9E409CF5634Ff","0xFA8aB85019fD70bcDe296184Da287f77A685baC3","0x7590b17e7058bc96debA6bFd3c40AD65c30CcD05","0x4Df59d30117Ba77d72b8Dc0BdA2cCa175Dd359f8","0x8F88d8565a59fA750c4E24dcE0C7C607D63C849F","0x71c2f183727a3CC22cDEab3361da88d0294A88D4","0x3eA2875b2587F0e9cBfa3ceE4Cf06557b8944323","0x17C9bA3791fdcb70341054C6e359D243A5954779","0x46e88058c66c4cB0A3381B3E9396a2057431314F","0xEdba20237B94e7Ec1a77E7DAcA80FC8cb8Dab6d8","0xaAe05569079540a2811b7B92efc0EA79b388c009","0x016630c7b151419F0c5362541FFA6104e3A753C7","0xfFBDE2B07379aAcFE85e742FC757672F005E74C4","0x21107cd80DA058e7E021d3623c4C4729c87D4B8e","0x625a9B61e44ac368CDD8af5D4edc22263f208d4a","0xA0dfc7B9C6408bEB9cdFe321c2B9B3fD80795526","0xC9992D694C5cFBe2834E35c9887b2aE2d08fe0fd","0xe88160d1C04F235682CD55C2194827838F25A524","0xe73756fEe19Ed6F07D9e2f83B984ee19799da88f","0xd53C8b3126C4E033B14F44432579A8111C0c832d","0xd4B1d5Aeb5a488BeaA486182567a708f9C7Fe6a6","0x40Eb4AF682a30c111631130Cf800BdBdC0A46b36","0x17b543f8454f378b809764b3292BD12401E884bf","0x0Ba865dD93E76AFa6696AB34c5C0b3F613aFc7Cd","0xF25e2940060fE956825b7F056885A39e9424E083","0x11371907128C7C5c1607a8d1b76d93A453aaE8Ea","0x418A15CE701E295757B2DFF98A0e7E9071fe5562","0xf3BB5ED6183ca5909a1b20866E6f134a923C417F","0xE97F580C8315F643D4cb7874aEe5a135eC7720dF","0x5412e643b7C2caF7E426f4CDAEaa03ce03b0F099","0x6a59dBddeE07d750Ef810A0A022b87749C746294","0xF333EF273712de6D2e04b227Ba430e5a58E9e373","0x026074170E4f07839Bec35b27Aed0787062fDF95","0x1Db1802e51e3fC302286067b5073a890E9350aC9","0x2D08C91Fb2c6212c5A2b53230DD781dC74c59e58","0x202eBfE00C3E0CC2D7A58A8a234377A6C34675d5","0x468fc2775f7f734aAc5031e82847A531D58DfdCa","0x1679Cb356B08B455dfe5c08558566461050a29A2","0x9D62e882903878eC047cAB17d5C8045639504513","0xB94a44fF36b9A6b4C824473ee7a643e570438063","0x533116CB4A374ddbF1C1373e2795104cc6C75b34","0xE9D9DEB8B3D6CDE0d3Cde3834229D1d6504B7429","0x2D9353dFE0C7F1C7C423643379714a55CaBceC8d","0x186844E3B0837DeD66F0ca557cacA4bC1b4CbB1e","0xa85Dae0dA2996D1E11A76Ca26489aD418eA4a4e1","0x1255faCbdcb745803cE0BCD55EE0B593248D944f","0xD1648A9dcEe02e7a9a6805a9F3B930429cB564d7","0x73836B55f6C46FcB04E1f0B05DFE47174FB12349","0x1E3515b3ca74584C87E289aFD4844d91e019aD82","0x6E170D53725DCb4DBd6aD0666313B50eB8d2D86E","0xF7bCc255A5eBA2A1e15C1067A469E574Faba8a55","0xE6ca0247b13DBDA292823241EF7B9fa48BfA8f23","0xdba5D84b14e2A26c243A39D407225798Df41fECf","0x73A5b0dD5Ee214793FB36844443fE4DF80096091","0x9Cd06618B7fe7649C557D5E0dab0541AA2A19c7B","0x5C5E637dA4874802580C0fEF96A2594F9160869e","0x0c038779aD637353C24BCE60100192b849F819F5","0x64ddd880b6818dF385847B7D37AacCfc0E14BC7e","0x1F5d1854b606c8961c9Fba9093555e03034f4B3D","0x6180a03b03a90aF1e9E466F5472EC8e2428EC558","0x2fAE725Da09c47cc6d1866eFd37853A308CC8600","0x3b7F0bd1536f1D6Dd5E83Cdd7834A5010174b0c2","0x64D9c17abe6ea4296dCC9456540E47c394517137","0xD81C62748753a399DA01820ff11f91e7508d6BA9","0x2FB3C2C8FCC913d39bCEc2b8ff3FBF2681cE74F7","0x4dfD082da17Ed89b6A343eAC7DBd90D2481Ce565","0x9a69090dD0FC1228A52E368c288dF1e1c3a9A9cE","0xD068e68090C9cCa538b36CFB26D4003959b4A694","0x1791817E21f598aeCBc614d6A486Cc30073c2861","0x394DE91ff4a4cB18063d04F59962D1900E5d8627","0x5872226bc9309135C4fc998fC4471aF29427E493","0x60C51c9CA2E038DF58fE03FC8Cd40Ecd2F5bD23D","0xBa51eeE1cA507CDC032DcEEF0A2A02c2C8b8a93c","0xaDd46d3EcdE2e03f4008d02e8B291eD55dE674Ee","0x341c5736131fab92F96fdb54bdeeAf82c3606322","0xa9383A240f3449860bB5A00a2283AA90e7482338","0xA49cB6187d6c1B1598B9495C507051A762D76723","0xAf9533b28AFF3e73e0015e3F66c872705A4ef048","0x69FBD92F4116b62Ca8F98fBB09e87f6902BD62d0","0x510978791e1EEb8b60D032c66fF3b36C4D3Edf09","0x932bb3dE43db528431886c9A4c19BCa38FAaFAE0","0x5885d7Dfe84b26bd50dC8e36F4603A649DFf808E","0x67518Eab650266E47aEa5F36c991DBF388D9dE58","0x47113D0e36574b68806AB73d4C3d2700a959b328","0xCAEFf825F1ec7815e0e6B29Af52a0B2bb700480E","0x44462dC53FFc30983373732C9a0E3405763387df","0x7e005aD12dFc38530091b01890D0fD812fe1B7c5","0x0Ecee3D041B3fF4Ae34D2c67D59048048dC1f6A7","0xcCF1279A93264894Db3234684329FA66bbb39A0d","0x9D28Cc6651f161bd997C817fe99BD561b4050Fb4","0x5368E8FE3FefaD5be7E4de044C44C9392d226dAa","0xD197Fea78991580E8CDb46DD251919eD88EEB61c","0x6a94eC15Fd0F910EDE7dcEDb36813A0aA01c6Af7","0x2f5e2A55374d90fAC2990BAa07A3750587Cb1973","0xef559A7F6607738B045b8B9c1A0f50EF6BC4214C","0x7B880522aa973EA357F404a28Bc9a60069971b71","0xE207C312bFB1e24A4930FcFb7dB0C35Adc0d2dFc","0x774996e8bd46dB9633a85063923DD90E6DA16347","0x5E2464B5EceD5AEfA42ca4687BB0f30bAC8216F7","0x7191788613788e5f8e3fecE3E40595Ef055AF733","0x231DaF08f614aF96b59d6Be3104AdeBd9fc006d6","0xbf1d574F3E4703BFA725403894F172b6a85c1Cd5","0x49B4DB858e60E57d3F26028DC1D2018631AAE867","0x32e27Fd82eD46Cbe96c1486EE8dDF49042342C14","0x534Bf443d9DC293C4B72b5C6b587329Bf9751b12","0xfF5Fa09dDC2F75801a245D866A9EE584D0D182a9","0x3Aa666BA987AEbD1D6a2813b5d63A330cf51Da8b","0x76e252671f58c2a1e7a5BD4f9deA6CA36c83E23E","0x528F8B6465E5F9e320858eB50B75C8F4a6476E5c","0x40b95452A874B78c768E88bb8148d276d435D19B","0xE64A75E20485bB39BdfCA55C64309A0Ac055DBEA","0x5078DD906C2Ae923395845f58fa8fd5AFD4f9DcE","0x04A67bb642cEAc2800fd27E56B79BF8e0e99bdA3","0xc74734FA43Bf6b603eae829D74a9e3BC187686c7","0x356c010d5e7A4E4548Bfd0fC836936a6429E3E56","0xD3F1154E82B799974BBefA1F18d3f026993CeE56","0x08e2ecbBa2dA2f5C94FC63457a151fBe72d4D4ef","0x1aEf70bd72000Ef63Db8303Fa9D32824ACAA1B63","0x36D37465219089a52b663682da41Ce784c69bb5F","0xC6FEf7dc7a93dD503A81fE0C4E70FBE83D04eD21","0x1d3C65a5D21A2B4C1cf2b9f45Cf170a8C809599f","0x49965e9DDcf4D62267cC1F36b7c6A2be626545d1","0x58bAD56059A9b3ABEF97569454EB28929e78e0B4","0x3EFde2Df3CEAC60322b5F762b9BDE58237fA7B64","0x8C763696Db61454B91587B4903415d588c3fB67a","0xba2D6f19a86722d344176648d2e7811a6F0C24bD","0x4A8BEb84fc6BCe661a4393b821B957b45fA1A5F4","0xf2b9eF40c0497AB9D0Da920f51808B6ae196B631","0xd84ef56072EC3D305B7d665E8f0645c4364bC63b","0x1D09E5f5ca154dA90424bE365B831a22d4a765Bf","0x0924b770a85526c02a8f76501358251780a4Fb57","0xf6eA6B7c1C265972c6b3B8E608C0f14D36cb240f","0xdd42E6dd814284F4F7d7972f5dc14A0D97C3964A","0x28baF972d979971c220Cb3816a9E672e1b15A68D","0x67152F92f8Eed9B8bc93FCC50166b5a39E02b6F5","0x67Ec368F51696B4c5F65aC63Ec56e8e7F5Ac00F9","0xC23Dc5F6879e8142fC6Fefa887B7d51321064605","0x115eD41627C28630502f5dA0Be58063872Cd12e2","0x187cB78aD07ee0ba124F75AfA094Feb7354A8081","0xF6aD9bcD9e15B90310df97e42F9A5fA1Af539099","0xf5F2b416b9FED63e406297C364f78140d94258f1","0xA129C1CA29F09a10f38edDAD91DD92cFb3d2db86","0x83dEeC3F56790BB253221c77ad758D4736E46b6d","0xF6ADe9f509237dea138E83cBEDF9537ffd715823","0x93a4CFBb1206AFc286EBc9ecA73AdbCF71445D7B","0x78f80D58db3b06A97C1D8b416fee7ccc0F5116B0","0xa3FEBa5157198d3538187e1d629431649D6d82F1","0x24c203AF683d1Dcf99E3EF7477a9C9AB8595BF40","0x90259E23C36d207346aa9ABc1402E1d75690E097","0x729822518123D88fCA6c1A1D3afC5A2Afe99B50d","0x932Dc8BE2e246E1FaC00851575c6ED71Ce145aB9","0x3aFfb6f57C5f5b77b86adE35F3B04Ba1b07F21F6","0xE28CD7eb7C11a70AcDb16B1f17a95D17598d3ba3","0x127eFbF6312558715c57d2e167d5dfD49197469F","0x0d0cfBE05c09F16d855E7Ebe992f5E6757f05edc","0xd2fF455D0454Cb81c832c5e6CCB46a2963894394","0xD9584eB8a0C2bAF68222E1F20A5d9dEfd4D74cfB","0xbA921653c719eA4284b39F0c90E67F5B53fE41Ec","0xF8D398A14213616F01ba68BC51136d848A45A030","0x11f61e0CFd2bb4c01fD29d943114545E338DAbf2","0x3B0ba90e99Dd8d6Aa76F73a1eCB2d7f46910e231"]

    for (let i = 0; i < 250; i++) {
      bigAmounts.push(BigInt(Math.round(Math.random() * 100000000)))
    }

    const bigTotal = bigAmounts.reduce((a,b) => a+b)

    const result = await DistributorFactory.deploy(
      newToken.address,
      // the total is off by one
      bigTotal,
      uri,
      0,
      bigAddresses,
      bigAmounts,
    )

    // two-thirds of a block is a reasonable sanity check on size
    expect(result.deployTransaction.gasLimit.toBigInt()).toBeLessThan(13000000n)
  })
})
