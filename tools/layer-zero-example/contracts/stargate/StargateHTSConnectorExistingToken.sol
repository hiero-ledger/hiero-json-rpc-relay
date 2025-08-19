// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.22;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {StargateType} from "./interfaces/IStargate.sol";
import {IERC20Minter} from "./interfaces/IERC20Minter.sol";
import {FeeParams, StargateBase} from "./StargateBase.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import "../hts/HederaTokenService.sol";
import "../hts/IHederaTokenService.sol";
import "../hts/KeyHelper.sol";
import "./StargateOFT.sol";

/// @title A Stargate contract representing an OFT. This contract will burn OFTs when sending tokens
/// @title to other chains and mint tokens when receiving them from other chains.
abstract contract StargateHTSConnectorExistingToken is StargateOFT, KeyHelper, HederaTokenService {
    address public htsTokenAddress;

    /// @notice Create a StargateOFT contract administering an OFT.
    /// @param _token The OFT to administer
    /// @param _sharedDecimals The minimum number of decimals used to represent value in this OFT
    /// @param _endpoint The LZ endpoint address
    /// @param _owner The account owning this contract
    constructor(
        address _token,
        uint8 _sharedDecimals,
        address _endpoint,
        address _owner
    ) StargateOFT(_token, _sharedDecimals, _endpoint, _owner) {
        htsTokenAddress = _token;
    }

    /// @notice Burn tokens to represent their removal from the local chain
    /// @param _from The address to burn tokens from
    /// @param _amount How many tokens to burn in LD
    /// @return amountSD The amount burned in SD
    function _inflow(address _from, uint256 _amount) internal virtual override returns (uint64 amountSD) {
        amountSD = _ld2sd(_amount);

        int256 transferResponse = HederaTokenService.transferToken(htsTokenAddress, _from, address(this), int64(uint64(_amount)));
        require(transferResponse == HederaTokenService.SUCCESS_CODE, "HTS: Transfer failed");

        (int256 response,) = HederaTokenService.burnToken(htsTokenAddress, int64(uint64(_amount)), new int64[](0));
        require(response == HederaTokenService.SUCCESS_CODE, "HTS: Burn failed");
    }

    /// @notice Mint tokens to represent their lading into the local chain
    /// @param _to The account to mint tokens for
    /// @param _amount The amount of tokens to mint
    /// @return success Whether the minting was successful
    function _outflow(address _to, uint256 _amount) internal virtual override returns (bool success) {
        (int256 response, ,) = HederaTokenService.mintToken(htsTokenAddress, int64(uint64(_amount)), new bytes[](0));
        require(response == HederaTokenService.SUCCESS_CODE, "HTS: Mint failed");

        int256 transferResponse = HederaTokenService.transferToken(htsTokenAddress, address(this), _to, int64(uint64(_amount)));
        require(transferResponse == HederaTokenService.SUCCESS_CODE, "HTS: Transfer failed");

        return true;
    }
}
