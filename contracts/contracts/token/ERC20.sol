// SPDX-License-Identifier: MIT
pragma solidity =0.8.16;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract GenericERC20 is ERC20 {
	uint8 d;

	constructor(
		string memory _name,
		string memory _symbol,
		uint8 _decimals,
		uint256 supply
	) ERC20(_name, _symbol) {
		d = _decimals;
		_mint(msg.sender, supply);
	}

	function decimals() public view virtual override returns (uint8) {
		return d;
	}
}

contract FakeUSDC is ERC20 {
	uint8 d;

	constructor(
		string memory _name,
		string memory _symbol,
		uint8 _decimals,
		uint256 supply
	) ERC20(_name, _symbol) {
		d = _decimals;
		_mint(msg.sender, supply);
	}

	function decimals() public view virtual override returns (uint8) {
		return d;
	}
}

contract FakeUSDT is ERC20 {
	uint8 d;

	constructor(
		string memory _name,
		string memory _symbol,
		uint8 _decimals,
		uint256 supply
	) ERC20(_name, _symbol) {
		d = _decimals;
		_mint(msg.sender, supply);
	}

	function decimals() public view virtual override returns (uint8) {
		return d;
	}
}
