// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import { IDistributor } from './IDistributor.sol';
import { IXReceiver } from './IXReceiver.sol';

/**
 * @notice Defines functions and events for receiving and tracking crosschain claims
 */
interface ICrosschain is IDistributor, IXReceiver {
    /**
   * @dev The beneficiary and recipient may be different addresses. The beneficiary is the address
   * eligible to receive the claim, and the recipient is where the funds are actually sent.
   */
  event CrosschainClaim(
    bytes32 indexed id,
    address indexed beneficiary,
    address indexed recipient,
    uint32 recipientDomain,
    uint256 amount
  );
}
