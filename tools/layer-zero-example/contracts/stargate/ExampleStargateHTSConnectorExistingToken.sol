// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../hts/HederaTokenService.sol";
import "../hts/IHederaTokenService.sol";
import "../hts/KeyHelper.sol";
import "../HTSConnectorExistingToken.sol";
import "./StargateHTSConnectorExistingToken.sol";

contract ExampleStargateHTSConnectorExistingToken is Ownable, StargateHTSConnectorExistingToken {
    constructor(
        address _tokenAddress,
        uint8 _sharedDecimals,
        address _lzEndpoint,
        address _delegate
    ) payable StargateHTSConnectorExistingToken(_tokenAddress, _sharedDecimals, _lzEndpoint, _delegate) Ownable(_delegate) {}
}
