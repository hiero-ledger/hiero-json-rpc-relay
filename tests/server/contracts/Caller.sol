// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

contract Caller {
    constructor() {
    }

    function pureMultiply() public pure returns (int) {
        return 2*2;
    }

    function msgSender() public view returns (address) {
        return msg.sender;
    }

    function txOrigin() public view returns (address) {
        return tx.origin;
    }

    function msgSig() public pure returns (bytes4) {
        return msg.sig;
    }

    function msgValue() public payable returns (uint) {
        return msg.value;
    }

    function addressBalance(address addr) public view returns (uint256) {
        return addr.balance;
    }
}
