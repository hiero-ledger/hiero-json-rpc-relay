// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

contract Basic {

    constructor() {}

    function ping() public pure returns (int) {
        return 1;
    }

    function destroy() public {
        selfdestruct(payable(msg.sender));
    }

    receive() external payable {}
}
