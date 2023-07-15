// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import '@openzeppelin/contracts/token/ERC20/IERC20.sol';
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol';

import { DistributionRecord } from './abstract/Distributor.sol';
import { TrancheVesting, Tranche } from './abstract/TrancheVesting.sol';
import { MerkleSet } from './abstract/MerkleSet.sol';
import { ISaleManager_v_1_3 } from '../sale/v1.3/ISaleManager.sol';

contract TrancheVestingSale_1_3 is TrancheVesting {
  ISaleManager_v_1_3 public immutable saleManager;
  bytes32 public immutable saleId;

  modifier validSaleParticipant(address beneficiary) {
    require(saleManager.getSpent(saleId, beneficiary) != 0, 'no purchases found');

    _;
  }

  constructor(
    ISaleManager_v_1_3 _saleManager, // where the purchase occurred
    bytes32 _saleId, // the sale id
    IERC20 _token, // the purchased token to distribute
    Tranche[] memory _tranches, // vesting tranches
    uint256 _voteFactor, // the factor for voting power (e.g. 15000 means users have a 50% voting bonus for unclaimed tokens)
    string memory _uri // information on the sale (e.g. merkle proofs)
  )
    TrancheVesting(
      _token,
      _saleManager.spentToBought(_saleId, _saleManager.getTotalSpent(_saleId)),
      _uri,
      _voteFactor,
      _tranches,
      0, // no delay
      0 // no salt
    )
  {
    require(address(_saleManager) != address(0), 'TVS_1_3_D: sale is address(0)');
    require(_saleId != bytes32(0), 'TVS_1_3_D: sale id is bytes(0)');

    // if the ERC20 token provides decimals, ensure they match
    int256 decimals = tryDecimals(_token);
    require(
      decimals == -1 || decimals == int256(_saleManager.getDecimals(_saleId)),
      'token decimals do not match sale'
    );
    require(_saleManager.isOver(_saleId), 'TVS_1_3_D: sale not over');

    saleManager = _saleManager;
    saleId = _saleId;
  }

  function NAME() external pure virtual override returns (string memory) {
    return 'TrancheVestingSale_1_3';
  }

  // File specific version - starts at 1, increments on every solidity diff
  function VERSION() external pure virtual override returns (uint256) {
    return 4;
  }

  function tryDecimals(IERC20 _token) internal view returns (int256) {
    try IERC20Metadata(address(_token)).decimals() returns (uint8 decimals) {
      return int256(uint256(decimals));
    } catch {
      return -1;
    }
  }

  function getPurchasedAmount(address buyer) public view returns (uint256) {
    /**
    Get the purchased token quantity from the sale
  
    Example: if a user buys $1.11 of a FOO token worth $0.50 each, the purchased amount will be 2.22 FOO
    Returns purchased amount: 2220000 (2.22 with 6 decimals)
    */
    return saleManager.getBought(saleId, buyer);
  }

  function initializeDistributionRecord(
    address beneficiary // the address that will receive tokens
  ) external validSaleParticipant(beneficiary) {
    _initializeDistributionRecord(beneficiary, getPurchasedAmount(beneficiary));
  }

  function claim(
    address beneficiary // the address that will receive tokens
  ) external validSaleParticipant(beneficiary) nonReentrant {
    uint256 purchasedAmount = getPurchasedAmount(beneficiary);
    // effects
    uint256 claimedAmount = super._executeClaim(beneficiary, purchasedAmount);
    // interactions
    super._settleClaim(beneficiary, claimedAmount);
  }

  function getDistributionRecord(
    address beneficiary
  ) external view override returns (DistributionRecord memory) {
    DistributionRecord memory record = records[beneficiary];

    // workaround prior to initialization
    if (!record.initialized) {
      record.total = uint120(getPurchasedAmount(beneficiary));
    }
    return record;
  }

  // get the number of tokens currently claimable by a specific user
  function getClaimableAmount(address beneficiary) public view override returns (uint256) {
    if (records[beneficiary].initialized) return super.getClaimableAmount(beneficiary);

    // we can get the claimable amount prior to initialization
    return
      (getPurchasedAmount(beneficiary) * getVestedFraction(beneficiary, block.timestamp)) /
      fractionDenominator;
  }
}
