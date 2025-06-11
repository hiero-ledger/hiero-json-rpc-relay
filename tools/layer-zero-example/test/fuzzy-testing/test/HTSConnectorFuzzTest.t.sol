// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "src/ExampleHTSConnectorMock.sol";
import {htsSetup} from "lib/hedera-forking/contracts/htsSetup.sol";

contract HTSConnectorFuzzTest is Test {
    uint32 public srcEid = 5644;
    ExampleHTSConnectorMock public htsConnector;

    /// Initialize ExampleHTSConnectorMock with mock dependencies
    function setUp() public {
        htsSetup();

        /// Basic data
        string memory name = "HTS_NAME";
        string memory symbol = "HTS_SYMBOL";
        address lzEndpoint = address(0xbD672D1562Dd32C23B563C989d8140122483631d);
        address delegate = address(0x160c);

        /// Deploy the ExampleHTSConnectorMock contract
        htsConnector = new ExampleHTSConnectorMock(name, symbol, lzEndpoint, delegate);
    }


     /// @notice Fuzz test for the _credit function in HTSConnector.
     /// @param _amountLD The amount of tokens in local decimals to credit.
     /// @param _to The address to credit the tokens to.
     /// @param _srcEid The source chain ID.
    function testFuzzCredit(uint256 _amountLD, address _to, uint32 _srcEid) public {
        /// Ensure the amount does not exceed int64 max to satisfy the require statement in _credit
        vm.assume(_amountLD <= uint64(type(int64).max));

        /// Ensure the recipient address is not the zero address
        vm.assume(_to != address(0));

        /// Call the exposed credit function
        uint256 returnedAmount = htsConnector.exposeCredit(_to, _amountLD, _srcEid);

        /// Assert that the returned amount matches the input amount
        assertEq(returnedAmount, _amountLD);
    }
}
