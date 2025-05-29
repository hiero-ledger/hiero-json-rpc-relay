// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.22;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract ERC20Mock is ERC20 {
    uint8 decimalsArg = 18;

    constructor(uint256 _initialMint, uint8 _decimals) ERC20("ERC20Mock", "E20M") {
        _mint(msg.sender, _initialMint);
        decimalsArg = _decimals;
    }

    function decimals() public view override returns (uint8) {
        return decimalsArg;
    }
}
