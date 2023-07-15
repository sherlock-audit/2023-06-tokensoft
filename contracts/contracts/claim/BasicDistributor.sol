// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { AdvancedDistributor, IERC20 } from "../claim/abstract/AdvancedDistributor.sol";

contract BasicDistributor is AdvancedDistributor {
	// The practical limit for this distributor is gas: distributing to 250 addresses costs about 7,000,000 gas!
	constructor(
		IERC20 _token, // the purchased token
		uint256 _total, // total claimable
		string memory _uri, // information on the sale (e.g. merkle proofs)
		uint256 _voteFactor, // voting power multiplier as fraction of fractionDenominator
		address[] memory _recipients,
		uint256[] memory _amounts
	) AdvancedDistributor(_token, _total, _uri, _voteFactor, 10000, 0, uint160(uint256(blockhash(block.number - 1)))) {
		require(_recipients.length == _amounts.length, "_recipients, _amounts different lengths");
		uint256 _t;
		for (uint256 i = _recipients.length; i != 0; ) {
			unchecked {
				--i;
			}

			_initializeDistributionRecord(_recipients[i], _amounts[i]);
			_t += _amounts[i];
		}
		require(_total == _t, "sum(_amounts) != _total");
	}

	function getVestedFraction(
		address, /*beneficiary*/
		uint256 /*time*/
	) public view override returns (uint256) {
		// all tokens vest immediately
		return fractionDenominator;
	}

	function NAME() external pure virtual override returns (string memory) {
		return "BasicDistributor";
	}

	function VERSION() external pure virtual override returns (uint256) {
		return 5;
	}

	function claim(address beneficiary) external nonReentrant {
		// effects
		uint256 claimedAmount = super._executeClaim(beneficiary, records[beneficiary].total);
		// interactions
		super._settleClaim(beneficiary, claimedAmount);
	}
}
