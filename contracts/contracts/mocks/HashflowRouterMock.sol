// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IHashflowQuote} from "../interfaces/IHashflowQuote.sol";

// See https://docs.hashflow.com/hashflow/taker/getting-started
contract HashflowRouterMock is IHashflowQuote {
	using SafeERC20 for IERC20;
	constructor() {}

	// mock a fee
  function estimateCrossChainFee() public pure returns (uint256) {
		return 1234;
	} 

	function tradeSingleHop (RFQTQuote calldata quote) public payable {
		// maker is a pool or separate account
		address maker = quote.externalAccount == address(0)
			? quote.pool
			: quote.externalAccount;

		// transfer base token to maker
		if (quote.baseToken != address(0)) {
			// this is an ERC20 transfer
			IERC20(quote.baseToken).safeTransferFrom(msg.sender, maker, quote.effectiveBaseTokenAmount);
		} else {
			// this is a native token transfer
    	(bool success, ) = maker.call{value: quote.effectiveBaseTokenAmount}("");
			require(success, "native baseToken trade failed");
		}

		// scale the quoted token transfer based on taker order size
		uint256 quoteTokenAmount = quote.maxQuoteTokenAmount * quote.effectiveBaseTokenAmount / quote.maxBaseTokenAmount;
			// transfer base token to maker
		if (quote.quoteToken != address(0)) {
			// this is an ERC20 transfer
			IERC20(quote.quoteToken).safeTransferFrom(maker, quote.trader, quoteTokenAmount);
		} else {
			// this is a native token transfer
			// the fake Hashflow router already holds a bunch of native tokens (probably not how this works in practice)
    	(bool success, ) = quote.trader.call{value: quoteTokenAmount}("");
			require(success, "native quoteToken trade failed");
		}
	}

	function tradeXChain (
		XChainRFQTQuote calldata quote,
		XChainMessageProtocol // protocol
	) public payable {
		if (quote.baseToken != address(0)) {
			// this is an ERC20 traade - pay for cross-chain fee in native token
		  require(msg.value == estimateCrossChainFee(), "incorrect xChainFeeEstimate");
		  IERC20(quote.baseToken).safeTransferFrom(msg.sender, quote.srcPool, quote.baseTokenAmount);
		} else {
			// this is a native trade - pay for the base token and cross-chain fee in native token
		  require(msg.value == estimateCrossChainFee() + quote.baseTokenAmount, "incorrect xChainFeeEstimate");
    	(bool success, ) = quote.srcPool.call{value: quote.baseTokenAmount}("");
			require(success, "x-chain native trade failed");
		}
		// The other half of the trade occurs on another chain
	}

	// fake - give maker a way to settle in ETH
	function depositEth() external payable {}
}

