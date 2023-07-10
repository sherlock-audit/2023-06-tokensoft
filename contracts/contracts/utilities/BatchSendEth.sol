// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

contract BatchSendEth {
	constructor() {}

	function send(address[] calldata addresses, uint256 amount) public payable {
		for (uint256 i = addresses.length; i != 0; ) {
			unchecked {
				--i;
			}

			addresses[i].call{ value: amount }("");
		}
	}
}
