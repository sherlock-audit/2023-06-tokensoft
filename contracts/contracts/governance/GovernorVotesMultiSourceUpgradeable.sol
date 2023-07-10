// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import {GovernorUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/GovernorUpgradeable.sol";
import {GovernorVotesUpgradeable, IVotesUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorVotesUpgradeable.sol";

abstract contract GovernorVotesMultiSourceUpgradeable is
	GovernorUpgradeable,
	GovernorVotesUpgradeable
{
	// Allow governor contract to reference additional vote sources
	IVotesUpgradeable[] private voteSources;

	modifier validVoteSources(IVotesUpgradeable[] calldata _voteSources) {
		for (uint256 i = 0; i < _voteSources.length; ) {
			require(
				_voteSources[i].getPastTotalSupply(block.number - 1) > 0,
				"GovernorVotesMultiSourceUpgradeable: source has no votes"
			);
			unchecked {
				++i;
			}
		}

		_;
	}

	function __GovernorVotesMultiSource_init(
		IVotesUpgradeable tokenAddress,
		IVotesUpgradeable[] calldata _voteSources
	) internal onlyInitializing {
		__GovernorVotesMultiSource_init__unchained(tokenAddress, _voteSources);
	}

	function __GovernorVotesMultiSource_init__unchained(
		IVotesUpgradeable tokenAddress,
		IVotesUpgradeable[] calldata _voteSources
	) internal onlyInitializing validVoteSources(_voteSources) {
		super.__GovernorVotes_init_unchained(tokenAddress);
		voteSources = _voteSources;
	}

	/**
	  Modified from open zeppelin defaults
	*/
	function _getVotes(
		address account,
		uint256 blockNumber,
		bytes memory _data
	)
		internal
		view
		virtual
		override(GovernorUpgradeable, GovernorVotesUpgradeable)
		returns (uint256 votes)
	{
		// get votes from the ERC20 token
		votes = super._getVotes(account, blockNumber, _data);

		// get votes from the distribution contracts
		IVotesUpgradeable[] memory _voteSources = voteSources;
		for (uint256 i = 0; i < _voteSources.length; ) {
      votes += voteSources[i].getPastVotes(account, blockNumber);
			unchecked {
				++i;
			}
		}
	}

	/**
	  New function allowing the DAO to update its vote sources
	*/
	function setVoteSources(IVotesUpgradeable[] calldata _voteSources)
		public
		onlyGovernance
		validVoteSources(_voteSources)
	{
		voteSources = _voteSources;
	}

	function getVoteSources() public view returns (IVotesUpgradeable[] memory) {
		return voteSources;
	}

	// permit future upgrades
	uint256[10] private __gap;
}
