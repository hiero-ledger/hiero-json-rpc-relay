// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

contract MockContract {
    function getAddress() public view returns (address) {
        return address(this);
    }

    function destroy() public {
        selfdestruct(payable(msg.sender));
    }
}

contract Deployer {
    uint256 public counter = 1;
    uint256 public salt = 1;
    uint256 public salt2 = 2;
    MockContract mockContract;

    constructor() payable {
        mockContract = new MockContract();
    }

    function updateCounter(uint256 _counter) public returns (uint256) {
        counter = _counter;
        return counter;
    }

    function getMockContractAddress() public view returns (address) {
        return address(mockContract);
    }

    function deployViaCreate() public returns (address) {
        MockContract newContract = new MockContract();

        return address(newContract);
    }

    function deployViaCreate2() public returns (address) {
        MockContract newContract = new MockContract{salt: bytes32(counter)}();

        return address(newContract);
    }

    receive() external payable {}
}