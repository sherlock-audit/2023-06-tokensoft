// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import "@openzeppelin/contracts-upgradeable/governance/TimelockControllerUpgradeable.sol";

contract MyTimelockControllerUpgradeable is TimelockControllerUpgradeable {
	/// @custom:oz-upgrades-unsafe-allow constructor
	constructor() {
		_disableInitializers();
	}

	function initialize(
		uint256 minDelay,
		address[] memory proposers,
		address[] memory executors
	) public initializer {
		__TimelockController_init(minDelay, proposers, executors);
	}
}
