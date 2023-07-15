const assertEnv = (name) => {
	const env = process.env[name]

	if (env == undefined) throw new Error(`environmental variable ${name} is undefined`)

	return env
}

module.exports = { assertEnv };
