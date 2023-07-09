// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import { SafeERC20 } from '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';

import { AdvancedDistributor, IERC20 } from './AdvancedDistributor.sol';
import { Distributor } from './Distributor.sol';
import { IConnext } from '../../interfaces/IConnext.sol';
import { ICrosschain } from '../../interfaces/ICrosschain.sol';

abstract contract CrosschainDistributor is AdvancedDistributor, ICrosschain {
  using SafeERC20 for IERC20;

  IConnext public immutable connext;
  uint32 public immutable domain;

  /**
   * @notice Throws if the msg.sender is not connext
   */
  modifier onlyConnext() {
    require(msg.sender == address(connext), '!connext');
    _;
  }

  constructor(IConnext _connext) {
    connext = _connext;
    domain = uint32(_connext.domain());
  }

  /**
   * @notice Settles claimed tokens to any valid Connext domain.
   * @dev permissions are not checked: call only after a valid claim is executed
   * @param _recipient: the address that will receive tokens
   * @param _recipientDomain: the domain of the address that will receive tokens
   * @param _amount: the amount of claims to settle
   */
  function _settleClaim(
    address _beneficiary,
    address _recipient,
    uint32 _recipientDomain,
    uint256 _amount
  ) internal virtual {
    bytes32 id;
    if (_recipientDomain == 0 || _recipientDomain == domain) {
      token.safeTransfer(_recipient, _amount);
    } else {
      id = connext.xcall(
        _recipientDomain, // destination domain
        _recipient, // to
        address(token), // asset
        _recipient, // delegate, only required for self-execution + slippage
        _amount, // amount
        0, // slippage -- assumes no pools on connext
        bytes('') // calldata
      );
    }
    emit CrosschainClaim(id, _beneficiary, _recipient, _recipientDomain, _amount);
  }
}
