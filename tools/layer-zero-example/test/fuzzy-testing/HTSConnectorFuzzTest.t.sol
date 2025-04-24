// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "forge-std/Test.sol";

contract HTSConnectorFuzzTest is Test {
    HTSConnectorMock public htsConnector;
    address public receiver;
    uint32 public srcEid;

    function setUp() public {
        // Initialize HTSConnectorMock with mock dependencies
        htsSetup();
        string memory name = "TestHTS";
        string memory symbol = "THTS";
        address lzEndpoint = address(0xbD672D1562Dd32C23B563C989d8140122483631d); // Mock LayerZero endpoint
        address delegate = address(0x456);   // Mock delegate

        // Deploy the HTSConnectorMock contract
        htsConnector = new HTSConnectorMock(name, symbol, lzEndpoint, delegate);

        // Set default receiver and source chain ID
        receiver = address(0xABC);
        srcEid = 12345;
    }

    /**
     * @notice Fuzz test for the _credit function in HTSConnector.
     * @param _amountLD The amount of tokens in local decimals to credit.
     * @param _to The address to credit the tokens to.
     * @param _srcEid The source chain ID.
     */
    function testFuzzCredit(uint256 _amountLD, address _to, uint32 _srcEid) public {
        // Ensure the amount does not exceed int64 max to satisfy the require statement in _credit
        vm.assume(_amountLD <= uint64(type(int64).max));

        // Ensure the recipient address is not the zero address
        vm.assume(_to != address(0));

        // Call the exposed credit function
        uint256 returnedAmount = htsConnector.exposeCredit(_to, _amountLD, _srcEid);

        // Assert that the returned amount matches the input amount
        assertEq(returnedAmount, _amountLD);

        // Additional assertions can be added here to verify state changes
        // For example, checking the balance of the recipient if applicable
    }
}