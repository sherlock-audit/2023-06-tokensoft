// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import { IERC20 } from '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import { ICrosschain } from '../../interfaces/ICrosschain.sol';
import { CrosschainDistributor } from './CrosschainDistributor.sol';
import { AdvancedDistributor } from './AdvancedDistributor.sol';
import { Distributor } from './Distributor.sol';
import { MerkleSet } from './MerkleSet.sol';
import { IConnext } from '../../interfaces/IConnext.sol';
import { IDistributor } from '../../interfaces/IDistributor.sol';
import { ECDSA } from '@openzeppelin/contracts/utils/cryptography/ECDSA.sol';

/**
 * @title CrosschainMerkleDistributor
 * @author
 * @notice Distributes funds to beneficiaries listed in a merkle proof on Connext-compatible chains. Every beneficiary
 * must be included in exactly one merkle leaf.
 *
 * @dev There are three ways to claim funds from this contract:
 *
 * 1. `claimBySignature` allows any address to claim funds on behalf of an EOA beneficiary to any Connext domain and recipient address (including recipients and domains not in the merkle leaf) by providing a merkle proof and beneficiary signature
 * 2. `claimByMerkleProof` allows any address to claim funds on behalf of a beneficiary to the Connext domain and address specified in the merkle leaf by providing a merkle proof
 * 3. `xReceive` allows any address on another Connext domain to claim funds on behalf of a beneficiary to the connext domain and address specified in the merkle leaf by providing a merkle proof
 *
 * A note on the merkle tree structure:
 *
 * The leaf structure used is: `hash(beneficiary, total, beneficiaryDomain)`.
 *
 * The contract is designed to support claims by both EOAs and contracts. If the beneficiary
 * is a contract, the merkle leaf domain must match the contract domain. In this case, you can only guarantee the beneficiary
 * controls their address on the domain the claim was initiated from (contracts do not share
 * addresses across chains). Including the domain context in the leaf allows the contract to
 * enforce this assertion via merkle proofs instead of using an authorized call (see:
 * https://docs.connext.network/developers/guides/authentication).
 */
abstract contract CrosschainMerkleDistributor is CrosschainDistributor, MerkleSet {
  event Foo(address bar);
  constructor(
    IConnext _connext,
    bytes32 _merkleRoot,
    uint256 _total
  ) CrosschainDistributor(_connext, _total) MerkleSet(_merkleRoot) {}

  /// @dev public method to initialize a distribution record: requires a valid merkle proof
  function initializeDistributionRecord(
    uint32 _domain, // the domain of the beneficiary
    address _beneficiary, // the address that will receive tokens
    uint256 _amount, // the total claimable by this beneficiary
    bytes32[] calldata merkleProof
  ) external validMerkleProof(_getLeaf(_beneficiary, _amount, _domain), merkleProof) {
    _initializeDistributionRecord(_beneficiary, _amount);
  }

  /**
   * @notice Used for cross-chain claims via Satellite, which triggers claims through Connext.
   * @dev This method is only callable by Connext, but anyone on any other Connext domain can
   * trigger this method call on behalf of a beneficiary. Claimed funds will always be sent to
   * the beneficiary address and beneficiary domain set in the merkle proof.
   * @param _callData Calldata from origin initiator (Satellite). Should include proof, leaf information, and recipient
   * information
   */
  function xReceive(
    bytes32, // _transferId,
    uint256, // _amount,
    address, // _asset,
    address, // _originSender,
    uint32, // _origin,
    bytes calldata _callData
  ) external onlyConnext returns (bytes memory) {
    // Decode the data
    (address beneficiary, uint32 beneficiaryDomain, uint256 totalAmount, bytes32[] memory proof) = abi
      .decode(_callData, (address, uint32, uint256, bytes32[]));
    _verifyMembership(_getLeaf(beneficiary, totalAmount, beneficiaryDomain), proof);

    // effects
    uint256 claimedAmount =  _executeClaim(beneficiary, totalAmount);

    // interactions
    _settleClaim(beneficiary, beneficiary, beneficiaryDomain, claimedAmount);

    return bytes('');
  }

  /**
   * @notice Claim tokens for a beneficiary using a merkle proof
   * @dev This method can be called by anyone, but claimed funds will always be sent to the
   * beneficiary address and domain set in the merkle proof.
   * @param _beneficiary The address of the beneficiary
   * @param _total The total claimable amount for this beneficiary
   * @param _proof The merkle proof
   */
  function claimByMerkleProof(
    address _beneficiary,
    uint256 _total,
    bytes32[] calldata _proof
  ) external {
    _verifyMembership(_getLeaf(_beneficiary, _total, domain), _proof);
    // effects
    uint256 claimedAmount = _executeClaim(_beneficiary, _total);

    // interactions
    _settleClaim(_beneficiary, _beneficiary, domain, claimedAmount);
  }

  /**
   * @notice Claim tokens for a beneficiary using a merkle proof and beneficiary signature. The beneficiary
   * may specify any Connext domain and recipient address to receive the tokens. Will validate
   * the proof and beneficiary signature, track the claim, and forward the funds to the designated
   * recipient on the designated chain.
   * @param _recipient The address to receive the claimed tokens
   * @param _recipientDomain The domain of the recipient
   * @param _beneficiary The address eligible to claim tokens based on a merkle leaf
   * @param _beneficiaryDomain The domain of the beneficiary set in a merkle leaf
   * @param _total The total quantity of tokens the beneficiary is eligible to claim
   * @param _signature The signature of the beneficiary on the leaf
   * @param _proof The merkle proof of the beneficiary leaf
   */
  function claimBySignature(
    address _recipient,
    uint32 _recipientDomain,
    address _beneficiary,
    uint32 _beneficiaryDomain,
    uint256 _total,
    bytes calldata _signature,
    bytes32[] calldata _proof
  ) external {
    // Recover the signature by beneficiary
    bytes32 _signed = keccak256(
      abi.encodePacked(_recipient, _recipientDomain, _beneficiary, _beneficiaryDomain, _total)
    );
    address recovered = _recoverSignature(_signed, _signature);
    require(recovered == _beneficiary, '!recovered');

    // Validate the claim
    _verifyMembership(_getLeaf(_beneficiary, _total, _beneficiaryDomain), _proof);
    uint256 claimedAmount = _executeClaim(_beneficiary, _total);

    _settleClaim(_beneficiary, _recipient, _recipientDomain, claimedAmount);
  }

  /**
   * @notice Allows the owner update the merkle root
   * @param _merkleRoot The new merkle root
   */
  function setMerkleRoot(bytes32 _merkleRoot) external onlyOwner {
    _setMerkleRoot(_merkleRoot);
  }

  /**
   * @notice Recover the signing address from an encoded payload.
   * @dev Will hash and convert to an eth signed message.
   * @param _signed The hash that was signed.
   * @param _sig The signature from which we will recover the signer.
   */
  function _recoverSignature(bytes32 _signed, bytes calldata _sig) internal pure returns (address) {
    // Recover
    return ECDSA.recover(ECDSA.toEthSignedMessageHash(_signed), _sig);
  }

  /**
   * @notice Generates the leaf from plaintext
   * @param _domain Beneficiary domain
   * @param _beneficiary Beneficiary address on domain
   * @param _total Total claim amount for the beneficiary
   */
  function _getLeaf(
    address _beneficiary, // the address that will receive tokens
    uint256 _total,
    uint32 _domain // the domain of the recipient
  ) internal pure returns (bytes32 _leaf) {
    _leaf = keccak256(abi.encodePacked(_beneficiary, _total, _domain));
  }
}
