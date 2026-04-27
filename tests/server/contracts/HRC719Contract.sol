// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.7;

import "./IHRC719.sol";

contract HRC719Contract {
    function associate(address token) public returns (uint256 responseCode) {
        return IHRC719(token).associate();
    }

    function dissociate(address token) public returns (uint256 responseCode) {
        return IHRC719(token).dissociate();
    }

    function isAssociated(address token) public view returns (bool) {
        return IHRC719(token).isAssociated();
    }
}
