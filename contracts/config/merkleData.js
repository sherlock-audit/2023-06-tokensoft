const simpleProofsArray = [
  {
    index: 0,
    account: "0x132c50A3D9439A21Cc8BfAdEEac06045DB3a29a7",
    amount: 5000000000000000000000,
    merkleProof: [
      "0x43e6dbdb9989e722b8276b0a8e14471f07acf13287f61bd733cf7aac7da16a7f",
      "0x90ed293a81a8d417102d3f3f3cb2488fb9ad4ecab2ecddd745f20f95b359d0c8",
      "0xffc5858cea39bdd0e871cf32d44d603f76b8d3591f6a6491bff1d43b55951275",
    ],
  },
  {
    index: 1,
    account: "0x8Cf384fe1810ce413CBc3A8d20a752E5a48aaDc0",
    amount: 5000000000000000000000,
    merkleProof: [
      "0x60c928dce63da75777e33948201751a726c783a7ff46c2eab1fab21673159300",
    ],
  },
  {
    index: 2,
    account: "0xDAED7b4eE2120655Ae25962ED2cFdfF3d142632b",
    amount: 5000000000000000000000,
    merkleProof: [
      "0xf3cbe65709eb347f02e95df324741817de60e0425e9aa3640dc537b04bf8d607",
      "0x90ed293a81a8d417102d3f3f3cb2488fb9ad4ecab2ecddd745f20f95b359d0c8",
      "0xffc5858cea39bdd0e871cf32d44d603f76b8d3591f6a6491bff1d43b55951275",
    ],
  },
  {
    index: 3,
    account: "0x8DA89bB07479DB1D8e2bE019750026129022cc41",
    amount: 5000000000000000000000,
    merkleProof: [
      "0x06441e138576678220730300f5b4e8e0c6b99d84fbd3ac2ec56a47a2190d69c3",
      "0xb560820ca44df67805d9cf1b67e79f56804553b87b0feec3c316cccdf6dd5d17",
      "0xffc5858cea39bdd0e871cf32d44d603f76b8d3591f6a6491bff1d43b55951275",
    ],
  },
];

const balancedTree = {
  merkleRoot:
    "0xe117ba62b4a23109e269a2f3706c12627adc8245a6aa786804b20fa150508177",
  totalDistributionAmount: "30000000000000000000000",
  "0xa4673B9e26aF90eeCe783f55eA85188c391A481C": {
    index: 0,
    beneficiary: "0xa4673B9e26aF90eeCe783f55eA85188c391A481C",
    amount: "5000000000000000000000",
    proof: [
      "0x33078affb52ab446bb0973cafde69f5dcf27779f81650be09da424033b22b1a5",
      "0x6d7d3b3b28e438d79ca89fdf3245ff6d1a91afbdb50adc1d0dfe62a21d9f3f0c",
      "0xa07da684cee805fcf8bda8a285a4a2fbf33e66cd6f6e55364b05255ad08ac9a0",
    ],
  },
  "0x78C6CC39131Ae0cCe3454dda04d233D0F8642Bc8": {
    index: 1,
    beneficiary: "0x78C6CC39131Ae0cCe3454dda04d233D0F8642Bc8",
    amount: "5000000000000000000000",
    proof: [
      "0x221f92da9d7894c28b22553edefe6e08b03303ebf5df5230a534a76b393feebf",
      "0xa377f429ed5d1aa7f0aa16a36b7d0197ea1c6d894e141baaf727e8b3d917cbf5",
      "0xa07da684cee805fcf8bda8a285a4a2fbf33e66cd6f6e55364b05255ad08ac9a0",
    ],
  },
  "0x132c50A3D9439A21Cc8BfAdEEac06045DB3a29a7": {
    index: 2,
    beneficiary: "0x132c50A3D9439A21Cc8BfAdEEac06045DB3a29a7",
    amount: "5000000000000000000000",
    proof: [
      "0x6310b524237a485fdaad926323d0066d3b0e52a0ee06f8307dd929c9ce84e60e",
      "0x9959570056b89df54f13f52dff8a2a4da878b170e9a866d77263bb990dfffedf",
    ],
  },
  "0x8Cf384fe1810ce413CBc3A8d20a752E5a48aaDc0": {
    index: 3,
    beneficiary: "0x8Cf384fe1810ce413CBc3A8d20a752E5a48aaDc0",
    amount: "5000000000000000000000",
    proof: [
      "0xd738d7260bb7d55d5d7123731f08c1258255eeadd40866a7652adf7c2aaa1e60",
      "0x9959570056b89df54f13f52dff8a2a4da878b170e9a866d77263bb990dfffedf",
    ],
  },
  "0xDAED7b4eE2120655Ae25962ED2cFdfF3d142632b": {
    index: 4,
    beneficiary: "0xDAED7b4eE2120655Ae25962ED2cFdfF3d142632b",
    amount: "5000000000000000000000",
    proof: [
      "0x3e7722b761396fafa43ee6540f5a84f0b65615c0a4ec8a02d06d140d5eaa3907",
      "0x6d7d3b3b28e438d79ca89fdf3245ff6d1a91afbdb50adc1d0dfe62a21d9f3f0c",
      "0xa07da684cee805fcf8bda8a285a4a2fbf33e66cd6f6e55364b05255ad08ac9a0",
    ],
  },
  "0x8DA89bB07479DB1D8e2bE019750026129022cc41": {
    index: 5,
    beneficiary: "0x8DA89bB07479DB1D8e2bE019750026129022cc41",
    amount: "5000000000000000000000",
    proof: [
      "0x1e9069aabfc5579b317b1bbda8a972be4c2597fbf15095df2d941606e10969ac",
      "0xa377f429ed5d1aa7f0aa16a36b7d0197ea1c6d894e141baaf727e8b3d917cbf5",
      "0xa07da684cee805fcf8bda8a285a4a2fbf33e66cd6f6e55364b05255ad08ac9a0",
    ],
  },
};

module.exports = { simpleProofsArray, balancedTree };
