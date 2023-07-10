/** @type import('hardhat/config').HardhatUserConfig */

require("hardhat-deploy");

// this allows hardhat to use ethers for tests
require("@nomiclabs/hardhat-ethers");

// this allows hardhat to use jest for tests
require("hardhat-jest-plugin");

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
