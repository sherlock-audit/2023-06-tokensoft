// SPDX-License-Identifier: MIT
pragma solidity 0.8.16;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IXReceiver } from '../interfaces/IXReceiver.sol';

contract ConnextMock {
    event XCalled(
        uint32 destination,
        address to,
        address asset,
        address delegate,
        uint256 amount,
        uint256 slippage,
        bytes callData
    );
    uint32 private _domain;
    constructor(uint32 domain_) {
        setDomain(domain_);
    }

    function domain() public view returns (uint32) {
        return _domain;
    }

    function setDomain(uint32 domain_) public {
        _domain = domain_;
    }

    function xcall(
        uint32 _destination,
        address _to,
        address _asset,
        address _delegate,
        uint256 _amount,
        uint256 _slippage,
        bytes calldata _callData
    ) public payable returns (bytes32) {
        // Transfer asset if needed
        if (_amount > 0) {
            IERC20(_asset).transferFrom(msg.sender, address(this), _amount);
        }
        
        // Emit event + return identifier
        emit XCalled(_destination, _to, _asset, _delegate, _amount, _slippage, _callData);
        return keccak256(abi.encode(_destination, _to, _asset, _delegate, _amount, _slippage, _callData));
    }

    // call the xreceive contract pretending to be connext on the same chain
    function callXreceive(
        bytes32 _transferId,
        uint256 _amount,
        address _asset,
        address _originSender,
        uint32 _origin,
        bytes32[] memory _proof,
        address _distributor) public returns (bytes memory) {

        return IXReceiver(_distributor).xReceive(
            _transferId,
            _amount,
            _asset,
            _originSender,
            _domain,
            abi.encode(_originSender, _origin, _amount, _proof)
        );
    }
}