// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { CrosschainMerkleDistributor, CrosschainDistributor } from './abstract/CrosschainMerkleDistributor.sol';
import { TrancheVesting, Tranche } from './abstract/TrancheVesting.sol';
import { Distributor } from './abstract/Distributor.sol';
import { AdvancedDistributor } from './abstract/AdvancedDistributor.sol';
import { IConnext } from '../interfaces/IConnext.sol';
import { IDistributor } from '../interfaces/IDistributor.sol';

/**
 * @title CrosschainTrancheVestingMerkle
 * @author
 * @notice Distributes funds to beneficiaries across Connext domains and vesting in tranches over time.
 */
contract CrosschainTrancheVestingMerkle is CrosschainMerkleDistributor, TrancheVesting {
  constructor(
    IERC20 _token,
    IConnext _connext,
    uint256 _total,
    string memory _uri,
    uint256 _voteFactor,
    Tranche[] memory _tranches,
    bytes32 _merkleRoot,
    uint160 _maxDelayTime // the maximum delay time for the fair queue
  )
    CrosschainMerkleDistributor(_connext, _merkleRoot, _total)
    TrancheVesting(_token, _total, _uri, _voteFactor, _tranches, _maxDelayTime, uint160(uint256(_merkleRoot)))
  {}

  // Every distributor must provide a name method 
  function NAME() external pure override(Distributor, IDistributor) returns (string memory) {
    return 'CrosschainTrancheVestingMerkle';
  }

  // Every distributor must provide a version method to track changes
  function VERSION() external pure override(Distributor, IDistributor) returns (uint256) {
    return 1;
  }

  function _setToken(IERC20 _token) internal override(AdvancedDistributor, CrosschainDistributor) {
    super._setToken(_token);
  }

  function _setTotal(uint256 _total) internal override(AdvancedDistributor, CrosschainDistributor) {
    super._setTotal(_total);
  }
}
