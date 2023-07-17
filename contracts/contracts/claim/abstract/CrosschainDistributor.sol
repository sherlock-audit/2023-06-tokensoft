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

  constructor(IConnext _connext, uint256 _total) {
    connext = _connext;
    domain = uint32(_connext.domain());
    _allowConnext(_total);
  }

  /**
  @dev allows Connext to withdraw tokens for cross-chain settlement. Connext may withdraw up to
  the remaining quantity of tokens that can be claimed - the allowance must be set for cross-chain claims.
  */
  function _allowConnext(uint256 amount) internal {
    token.safeApprove(address(connext), amount);
  }

  /** Reset Connext allowance when total is updated */
  function _setTotal(uint256 _total) internal virtual override onlyOwner {
    // effects
    super._setTotal(_total);
    // interactions
    _allowConnext(total - claimed);
  }

  /** Reset Connext allowance when token is updated */
  function _setToken(IERC20 _token) internal virtual override nonReentrant onlyOwner {
    // interaction before effect!
    // decrease allowance on old token
    _allowConnext(0);

    // effect
    super._setToken(_token);

    // interactions
    // increase allowance on new token
    _allowConnext(total - claimed);
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
