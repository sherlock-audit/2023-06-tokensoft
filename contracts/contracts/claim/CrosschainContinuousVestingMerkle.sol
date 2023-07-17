// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { CrosschainMerkleDistributor } from './abstract/CrosschainMerkleDistributor.sol';
import { CrosschainDistributor } from './abstract/CrosschainDistributor.sol';
import { ContinuousVesting } from './abstract/ContinuousVesting.sol';
import { Distributor } from './abstract/Distributor.sol';
import { AdvancedDistributor } from './abstract/AdvancedDistributor.sol';
import { IConnext } from '../interfaces/IConnext.sol';
import { IDistributor } from '../interfaces/IDistributor.sol';
import { ECDSA } from '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';

/**
 * @title CrosschainContinuousVestingMerkle
 * @author
 * @notice Distributes funds to beneficiaries across Connext domains and vesting continuously between a start and end date.
 */
contract CrosschainContinuousVestingMerkle is CrosschainMerkleDistributor, ContinuousVesting {
  constructor(
    IERC20 _token,
    IConnext _connext,
    uint256 _total,
    string memory _uri,
    uint256 _voteFactor,
    uint256 _start,
    uint256 _cliff,
    uint256 _end,
    bytes32 _merkleRoot,
    uint160 _maxDelayTime // the maximum delay time for the fair queue
  )
    CrosschainMerkleDistributor(_connext, _merkleRoot, _total)
    ContinuousVesting(
      _token,
      _total,
      _uri,
      _voteFactor,
      _start,
      _cliff,
      _end,
      _maxDelayTime,
      uint160(uint256(_merkleRoot))
    )
  {}

  // every distributor must provide a name method
  function NAME() external pure override(Distributor, IDistributor) returns (string memory) {
    return 'CrosschainContinuousVestingMerkle';
  }

  // every distributor must provide a version method
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
