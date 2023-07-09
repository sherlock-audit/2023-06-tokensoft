// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import {GovernorMultiSourceUpgradeable, TimelockControllerUpgradeable, IVotesUpgradeable} from "../governance/GovernorMultiSourceUpgradeable.sol";

// IMPORTANT: DO NOT USE THIS CONTRACT IN PRODUCTION: THE VOTING PERIOD IS TOO SHORT!
// Change the voting delay and voting period to be shorter for testing (these are hard-coded in the real contract for gas efficiency)
contract GovernorMultiSourceUpgradeableMock is GovernorMultiSourceUpgradeable {
	/// @custom:oz-upgrades-unsafe-allow constructor
	constructor() {
		_disableInitializers();
	}

	function initialize(
		IVotesUpgradeable _token,
		TimelockControllerUpgradeable _timelock,
		IVotesUpgradeable[] calldata _voteSources
	) public override initializer {
		__Governor_init("Governor");
		__GovernorCountingSimple_init();
		__GovernorVotesMultiSource_init(_token, _voteSources);
		__GovernorVotesQuorumFraction_init(5); // the quorum numerator (5%)
		__GovernorTimelockControl_init(_timelock);
		__Ownable_init();
		__UUPSUpgradeable_init();
	}

	function votingDelay() public pure override returns (uint256) {
		return 0;
	}

	function votingPeriod() public pure override returns (uint256) {
		// 10 blocks
		return 10;
	}
}
