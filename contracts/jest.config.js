/*
 * For a detailed explanation regarding each configuration property and type check, visit:
 * https://jestjs.io/docs/en/configuration.html
 */
module.exports = {
  preset: "ts-jest",
  testMatch: [
    "**.test.ts"
  ],
  verbose: true,
  // circumvent issues with JSON bigint serialization: see https://github.com/facebook/jest/issues/11617
  maxWorkers: 1
};
