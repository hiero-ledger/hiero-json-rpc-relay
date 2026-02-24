// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

contract Slots {
    uint256 public SLOT_0 = 1;
    uint256 public SLOT_1 = 2;
    uint256 public SLOT_2 = 2;
    uint256 public SLOT_3 = 2;

    function setSlot0(uint256 x) external {
        SLOT_0 = x;
    }

    function setSlot1And2(uint256 x) external {
        SLOT_1 = x;
        SLOT_2 = x;
    }
}
