// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.5.0 <0.9.0;

contract Storage {
    uint storedUint = 15;

    function updateStoredUInt() public {
        storedUint = 8;
    }
}