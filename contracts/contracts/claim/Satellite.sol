// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import { IConnext } from '../interfaces/IConnext.sol';
import { ICrosschain } from '../interfaces/ICrosschain.sol';
import { MerkleSet } from './abstract/MerkleSet.sol';

/**
 * @title Satellite
 * @notice This contract allows a beneficiary to claim tokens to this chain from a Distributor on another chain.
 * This contract validates inclusion in the merkle root, but only as a sanity check. The distributor contract
 * is the source of truth for claim eligibility.
 *
 * @dev The beneficiary domain in the merkle leaf must be this contract's domain. The beneficiary address may be
 * an EOA or a smart contract and must match msg.sender. The Satellite contract(s) and CrosschainDistributor contracts must only
 * be deployed on chains supported by the Connext protocol.
 * 
 * Note that anyone could deploy a fake Satellite contract that does not require msg.sender to match the beneficiary or the Satellite
 * domain to match the beneficiary domain. This would allow the attacker to claim tokens from the distributor on behalf of a beneficiary onto
 * the chain / domain specified by that beneficiary's merkle leaf. This is not a security risk to the CrosschainMerkleDistributor,
 * as this is the intended behavior for a properly constructed merkle root.
 */

contract Satellite is MerkleSet {
  // ========== Events ===========

  /**
   * @notice Emitted when a claim is initiated
   * @param id The transfer id for sending claim to distributor
   * @param beneficiary The user claiming tokens
   * @param total The beneficiary's total claimable token quantity (which may not be immediately claimable due to vesting conditions)
   */
  event ClaimInitiated(bytes32 indexed id, address indexed beneficiary, uint256 total);

  // ========== Storage ===========

  /**
   * @notice The distributor hosted on on distributorDomain
   */
  ICrosschain public immutable distributor;

  /**
   * @notice The domain of the distributor
   */
  uint32 public immutable distributorDomain;

  /**
   * @notice The domain of this satellite
   */
  uint32 public immutable domain;

  /**
   * @notice Address of Connext on the satellite domain
   */
  IConnext public immutable connext;

  constructor(
    IConnext _connext,
    ICrosschain _distributor,
    uint32 _distributorDomain,
    bytes32 _merkleRoot
  ) MerkleSet(_merkleRoot) {
    distributor = _distributor;
    distributorDomain = _distributorDomain;
    connext = _connext;
    domain = uint32(_connext.domain());

    // the distributor must be deployed on a different domain than the satellite
    require(_distributorDomain != domain, 'same domain');
  }

  // ========== Public Methods ===========

  /**
   * @notice Initiates crosschain claim by msg.sender, relayer fees paid by native asset only.
   * @dev Verifies membership in distribution merkle proof and xcalls to Distributor to initiate claim
   * @param total The amount of the claim (in leaf)
   * @param proof The merkle proof of the leaf in the root
   */
  function initiateClaim(uint256 total, bytes32[] calldata proof) public payable {
    // load values into memory to reduce sloads
    uint32 _distributorDomain = distributorDomain;
    uint32 _domain = domain;

    // Verify the proof before sending cross-chain as a cost + time saving step
    _verifyMembership(keccak256(abi.encodePacked(msg.sender, total, _domain)), proof);

    // Send claim to distributor via crosschain call
    bytes32 transferId = connext.xcall{ value: msg.value }(
      _distributorDomain, // destination domain
      address(distributor), // to
      address(0), // asset
      address(0), // delegate, only required for self-execution + slippage
      0, // total
      0, // slippage
      abi.encodePacked(msg.sender, _domain, total, proof) // data
    );

    // Emit event
    emit ClaimInitiated(transferId, msg.sender, total);
  }
}
