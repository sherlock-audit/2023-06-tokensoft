// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

contract FakeChainlinkOracle is AggregatorV3Interface {
	int256 private answer;
	string private oracleDescription;

	constructor(int256 _answer, string memory _oracleDescription) {
		answer = _answer;
		oracleDescription = _oracleDescription;
	}

	function decimals() external pure returns (uint8) {
		return 8;
	}

	function description() external view returns (string memory) {
		return oracleDescription;
	}

	function version() external pure returns (uint256) {
		return 3;
	}

	function setAnswer(int256 _answer) public {
		answer = _answer;
	}

	function latestRoundData()
		external
		view
		returns (
			uint80 roundId,
			int256,
			uint256 startedAt,
			uint256 updatedAt,
			uint80 answeredInRound
		)
	{
		return (92233720368547777283, answer, 1644641759, 1644641759, 92233720368547777283);
	}

	function getRoundData(uint80 _roundId)
		external
		view
		returns (
			uint80 roundId,
			int256,
			uint256 startedAt,
			uint256 updatedAt,
			uint80 answeredInRound
		)
	{
		return (92233720368547777283, answer, 1644641759, 1644641759, 92233720368547777283);
	}
}

contract FakeEthOracle is AggregatorV3Interface {
	int256 private answer;
	string private oracleDescription;

	constructor(int256 _answer, string memory _oracleDescription) {
		answer = _answer;
		oracleDescription = _oracleDescription;
	}

	function decimals() external pure returns (uint8) {
		return 8;
	}

	function description() external view returns (string memory) {
		return oracleDescription;
	}

	function version() external pure returns (uint256) {
		return 3;
	}

	function setAnswer(int256 _answer) public {
		answer = _answer;
	}

	function latestRoundData()
		external
		view
		returns (
			uint80 roundId,
			int256,
			uint256 startedAt,
			uint256 updatedAt,
			uint80 answeredInRound
		)
	{
		return (92233720368547777283, answer, 1644641759, 1644641759, 92233720368547777283);
	}

	function getRoundData(uint80 _roundId)
		external
		view
		returns (
			uint80 roundId,
			int256,
			uint256 startedAt,
			uint256 updatedAt,
			uint80 answeredInRound
		)
	{
		return (92233720368547777283, answer, 1644641759, 1644641759, 92233720368547777283);
	}
}

contract FakeUsdcOracle is AggregatorV3Interface {
	int256 private answer;
	string private oracleDescription;

	constructor(int256 _answer, string memory _oracleDescription) {
		answer = _answer;
		oracleDescription = _oracleDescription;
	}

	function decimals() external pure returns (uint8) {
		return 8;
	}

	function description() external view returns (string memory) {
		return oracleDescription;
	}

	function version() external pure returns (uint256) {
		return 3;
	}

	function setAnswer(int256 _answer) public {
		answer = _answer;
	}

	function latestRoundData()
		external
		view
		returns (
			uint80 roundId,
			int256,
			uint256 startedAt,
			uint256 updatedAt,
			uint80 answeredInRound
		)
	{
		return (92233720368547777283, answer, 1644641759, 1644641759, 92233720368547777283);
	}

	function getRoundData(uint80 _roundId)
		external
		view
		returns (
			uint80 roundId,
			int256,
			uint256 startedAt,
			uint256 updatedAt,
			uint80 answeredInRound
		)
	{
		return (92233720368547777283, answer, 1644641759, 1644641759, 92233720368547777283);
	}
}

contract FakeUsdtOracle is AggregatorV3Interface {
	int256 private answer;
	string private oracleDescription;

	constructor(int256 _answer, string memory _oracleDescription) {
		answer = _answer;
		oracleDescription = _oracleDescription;
	}

	function decimals() external pure returns (uint8) {
		return 8;
	}

	function description() external view returns (string memory) {
		return oracleDescription;
	}

	function version() external pure returns (uint256) {
		return 3;
	}

	function setAnswer(int256 _answer) public {
		answer = _answer;
	}

	function latestRoundData()
		external
		view
		returns (
			uint80 roundId,
			int256,
			uint256 startedAt,
			uint256 updatedAt,
			uint80 answeredInRound
		)
	{
		return (92233720368547777283, answer, 1644641759, 1644641759, 92233720368547777283);
	}

	function getRoundData(uint80 _roundId)
		external
		view
		returns (
			uint80 roundId,
			int256,
			uint256 startedAt,
			uint256 updatedAt,
			uint80 answeredInRound
		)
	{
		return (92233720368547777283, answer, 1644641759, 1644641759, 92233720368547777283);
	}
}
