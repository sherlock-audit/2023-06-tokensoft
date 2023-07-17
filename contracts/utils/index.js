const config = require("../config");

const buildIpfsUri = (cid) => `ipfs://${cid}`;

const getDefaultSaleUri = () => buildIpfsUri(config.campaignCIDs.basicSale);

const assertEnv = (name) => {
	const env = process.env[name]

	if (env == undefined) throw new Error(`environmental variable ${name} is undefined`)

	return env
}

module.exports = { buildIpfsUri, getDefaultSaleUri };
