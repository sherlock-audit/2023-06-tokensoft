// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { AggregatorV3Interface } from "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";

import { DistributionRecord } from "../interfaces/IDistributor.sol";
import { PriceTierVesting, PriceTier } from "./abstract/PriceTierVesting.sol";
import { MerkleSet } from "./abstract/MerkleSet.sol";
import { FlatPriceSale } from "../sale/v2/FlatPriceSale.sol";

contract PriceTierVestingSale_2_0 is PriceTierVesting {
	FlatPriceSale public immutable sale;
	uint256 public immutable price;
	uint8 public immutable soldTokenDecimals;

	modifier validSaleParticipant(address beneficiary) {
		require(sale.buyerTotal(beneficiary) != 0, "no purchases found");

		_;
	}

	constructor(
		FlatPriceSale _sale, // where the purchase occurred
		IERC20 _token, // the purchased token
		uint8 _soldTokenDecimals, // the number of decimals used by the purchased token
		// the price of the purchased token denominated in the sale's base currency with 8 decimals
		// e.g. if the sale was selling $FOO at $0.55 per token, price = 55000000
		uint256 _price,
		// when price tier vesting opens (seconds past epoch)
		uint256 _start,
		// when price tier vesting ends (seconds past epoch) and all tokens are unlocked
		uint256 _end,
		// source for pricing info
		AggregatorV3Interface _oracle,
		PriceTier[] memory priceTiers, // vesting PriceTiers
		uint256 _voteFactor, // the factor for voting power in basis points (e.g. 15000 means users have a 50% voting bonus for unclaimed tokens)
		string memory _uri // information on the sale (e.g. merkle proofs)
	)
		PriceTierVesting(
			_token,
			(_sale.total() * 10**_soldTokenDecimals) / _price,
			_uri,
			_voteFactor,
			_start,
			_end,
			_oracle,
			priceTiers
		)
	{
		require(address(_sale) != address(0), "sale is address(0)");

		// previously deployed v2.0 sales did not implement the isOver() method
		(, , , , , , uint256 endTime, , ) = _sale.config();
		require(endTime < block.timestamp, "sale not over yet");
		require(_price != 0, "price is 0");

		sale = _sale;
		soldTokenDecimals = _soldTokenDecimals;
		price = _price;
	}

	function NAME() external pure virtual override returns (string memory) {
		return "PriceTierVestingSale_2_0";
	}

	// File specific version - starts at 1, increments on every solidity diff
	function VERSION() external pure virtual override returns (uint256) {
		return 3;
	}

	function getPurchasedAmount(address buyer) public view returns (uint256) {
		/**
    Get the quantity purchased from the sale and convert it to native tokens
  
    Example: if a user buys $1.11 of a FOO token worth $0.50 each, the purchased amount will be 2.22 FOO
    - buyer total: 111000000 ($1.11 with 8 decimals)
    - decimals: 6 (the token being purchased has 6 decimals)
    - price: 50000000 ($0.50 with 8 decimals)

    Calculation: 111000000 * 1000000 / 50000000

    Returns purchased amount: 2220000 (2.22 with 6 decimals)
    */
		return (sale.buyerTotal(buyer) * (10**soldTokenDecimals)) / price;
	}

	function initializeDistributionRecord(
		address beneficiary // the address that will receive tokens
	) external validSaleParticipant(beneficiary) {
		_initializeDistributionRecord(beneficiary, getPurchasedAmount(beneficiary));
	}

	function claim(
		address beneficiary // the address that will receive tokens
	) external validSaleParticipant(beneficiary) nonReentrant {
		uint256 claimableAmount = getClaimableAmount(beneficiary);
		uint256 purchasedAmount = getPurchasedAmount(beneficiary);

		// effects
		uint256 claimedAmount = super._executeClaim(beneficiary, purchasedAmount);

		// interactions
		super._settleClaim(beneficiary, claimedAmount);
	}

	function getDistributionRecord(address beneficiary)
		external
		view
		virtual
		override
		returns (DistributionRecord memory)
	{
		DistributionRecord memory record = records[beneficiary];

		// workaround prior to initialization
		if (!record.initialized) {
			record.total = uint120(getPurchasedAmount(beneficiary));
		}
		return record;
	}

	// get the number of tokens currently claimable by a specific user
	function getClaimableAmount(address beneficiary) public view override returns (uint256) {
		if (records[beneficiary].initialized) return super.getClaimableAmount(beneficiary);

		// we can get the claimable amount prior to initialization
		return
			(getPurchasedAmount(beneficiary) * getVestedFraction(beneficiary, block.timestamp)) /
			fractionDenominator;
	}
}
