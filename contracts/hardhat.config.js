/** @type import('hardhat/config').HardhatUserConfig */

require("hardhat-deploy");

// generate typescript types upon compilation
require("@typechain/hardhat");

// this allows hardhat to use ethers for tests
require("@nomiclabs/hardhat-ethers");

// allow upgradeable contracts in tests
// require('@openzeppelin/hardhat-upgrades');

// this allows hardhat to use jest for tests
require("hardhat-jest");

module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.16",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true
        },
      },
    ],
  }
};
