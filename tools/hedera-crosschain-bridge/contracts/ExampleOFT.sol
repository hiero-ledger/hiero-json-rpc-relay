// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.22;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {OFT} from "@layerzerolabs/lz-evm-oapp-v2/contracts/oft/OFT.sol";

contract ExampleOFT is OFT {
    uint8 decimalsArg = 8;

    constructor(
        string memory _name,
        string memory _symbol,
        address _lzEndpoint,
        address _delegate,
        uint256 _initialMint,
        uint8 _decimals
    ) OFT(_name, _symbol, _lzEndpoint, _delegate) Ownable(_delegate) {
        _mint(msg.sender, _initialMint);
        decimalsArg = _decimals;
    }

    function decimals() public view override returns (uint8) {
        return decimalsArg;
    }
}
