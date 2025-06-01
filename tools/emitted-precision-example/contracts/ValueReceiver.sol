// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract ValueReceiver {
    uint256 public transactionCount;

    event ValueReceived(address indexed sender, uint256 amount, uint256 count);

    function testEmittedValues() external payable {
        transactionCount++;
        emit ValueReceived(msg.sender, msg.value, transactionCount);
    }
}