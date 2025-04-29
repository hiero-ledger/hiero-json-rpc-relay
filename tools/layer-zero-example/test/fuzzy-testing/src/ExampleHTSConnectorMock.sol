// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./HTSConnectorMock.sol";

/// Mocks ExampleHTSConnector
contract ExampleHTSConnectorMock is Ownable, HTSConnectorMock {
    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint,
        address _delegate
    ) payable HTSConnectorMock (_name, _symbol, _lzEndpoint, _delegate) Ownable(_delegate) {}

    /// Expose credit for test purpose only
    function exposeCredit(address _to, uint256 _amountLD, uint32 _srcEid) external returns (uint256) {
        return _credit(_to, _amountLD, _srcEid);
    }
}
