// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/HTSConnector.sol";


contract HTSConnectorMock is HTSConnector {

    // Expose the internal _credit function as a public function for testing
    function exposeCredit(address _to, uint256 _amountLD, uint32 _srcEid) external returns (uint256) {
        return _credit(_to, _amountLD, _srcEid);
    }
}
