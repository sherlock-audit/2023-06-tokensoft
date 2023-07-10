const { ethers } = require("hardhat");
const { simpleProofsArray, balancedTree } = require("./merkleData");

const addresses = {
  GNOSIS_SAFE_GOERLI: "0x281365Bf89C9Ab44462D8f70bEda241b1B24C6bB",
};

const merkleRoots = {
  public: '0x0000000000000000000000000000000000000000000000000000000000000000',
  tokensoftDevs: '0xb613dab8b7189ee0286275425d0d77df7cbb7550ba579c1a70def1b1acb931a2'
};

const campaignCIDs = {
  basicSale: "Qma51yJyJBKgxLVc9feg4b9RSuMq1ynrfqs5vEZkZyC4Zi",
  tokensoftDevsOnlySale: "Qma51yJyJBKgxLVc9feg4b9RSuMq1ynrfqs5vEZkZyC4Zi"
};

const dateTimestamps = {
  JUNE_1_2022: 1654066800,
  JUNE_1_2023: 1685602800,
};

const uints = {
  ONE_YEAR: 31536000,
  FOUR_YEARS: 126144000,
  TEN_MILLION: "10000000000000000000000000",
  TEN_BILLION: "10000000000000000000000000000",
};

const merkleData = {
  rootZero: ethers.constants.HashZero, // 0x0
  balancedTree,
  simpleClaimTree: {
    merkleRoot:
      "0x080658a34ceaef57f8ed16606943f19b652009929c038cc578fb0ccebbc75fdc",
    proofs: simpleProofsArray,
  },
};
// formatBytes32String
module.exports = {
  addresses,
  campaignCIDs,
  dateTimestamps,
  uints,
  merkleData,
  merkleRoots
};
