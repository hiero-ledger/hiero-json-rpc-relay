// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.5.0 <0.9.0;
pragma experimental ABIEncoderV2;

import "./TokenCreate.sol";

contract TokenContractContract is TokenCreate {


    event AllowanceValue(uint256 amount);
    event ApprovedAddress(address approved);
    event Approved(bool approved);
    event FungibleTokenInfo(IHederaTokenService.FungibleTokenInfo tokenInfo);
    event TokenCustomFees(IHederaTokenService.FixedFee[] fixedFees, IHederaTokenService.FractionalFee[] fractionalFees, IHederaTokenService.RoyaltyFee[] royaltyFees);
    event TokenDefaultKycStatus(bool defaultKycStatus);
    event KycGranted(bool kycGranted);

    function approvePublic(address token, address spender, uint256 amount) public returns (int responseCode) {
        responseCode = HederaTokenService.approve(token, spender, amount);
        emit ResponseCode(responseCode);
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert ();
        }
    }

    function approveNFTPublic(address token, address approved, uint256 serialNumber) public returns (int responseCode)
    {
        responseCode = HederaTokenService.approveNFT(token, approved, serialNumber);

        emit ResponseCode(responseCode);

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert ();
        }
    }

    function allowancePublic(address token, address owner, address spender) public returns (int responseCode, uint256 amount) {
        (responseCode, amount) = HederaTokenService.allowance(token, owner, spender);
        emit ResponseCode(responseCode);
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert ();
        }
        emit AllowanceValue(amount);
    }


    function transferTokenPublic(address token, address sender, address receiver, int64 amount) public returns (int responseCode) {
        responseCode = HederaTokenService.transferToken(token, sender, receiver, amount);
        emit ResponseCode(responseCode);
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert();
        }
    }

    function cryptoTransferPublic(IHederaTokenService.TokenTransferList[] calldata tokenTransferList) public returns (int responseCode) {
        responseCode = HederaTokenService.cryptoTransfer(tokenTransferList);
        emit ResponseCode(responseCode);
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert();
        }
    }

    function getApprovedPublic(address token, uint256 serialNumber) public returns (int responseCode, address approved)
    {
        (responseCode, approved) = HederaTokenService.getApproved(token, serialNumber);
        emit ResponseCode(responseCode);

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert();
        }

        emit ApprovedAddress(approved);
    }

    function setApprovalForAllPublic(address token, address operator, bool approved) public returns (int responseCode)
    {
        responseCode = HederaTokenService.setApprovalForAll(token, operator, approved);
        emit ResponseCode(responseCode);

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert();
        }
    }


    function isApprovedForAllPublic(address token, address owner, address operator) public returns (int responseCode, bool approved)
    {
        (responseCode, approved) = HederaTokenService.isApprovedForAll(token, owner, operator);
        emit ResponseCode(responseCode);

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert();
        }

        emit Approved(approved);
    }

    function getFungibleTokenInfoPublic(address token) public returns (int responseCode, IHederaTokenService.FungibleTokenInfo memory tokenInfo) {
        (responseCode, tokenInfo) = HederaTokenService.getFungibleTokenInfo(token);

        emit ResponseCode(responseCode);

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert();
        }

        emit FungibleTokenInfo(tokenInfo);
    }


    function createFungibleTokenWithCustomFeesPublic(
        address treasury,
        address fixedFeeTokenAddress
    ) public payable {
        IHederaTokenService.TokenKey[] memory keys = new IHederaTokenService.TokenKey[](1);
        keys[0] = getSingleKey(0, 0, 1, bytes(""));

        IHederaTokenService.Expiry memory expiry = IHederaTokenService.Expiry(
            0, treasury, 8000000
        );

        IHederaTokenService.HederaToken memory token = IHederaTokenService.HederaToken(
            name, symbol, treasury, memo, true, maxSupply, false, keys, expiry
        );

        IHederaTokenService.FixedFee[] memory fixedFees = new IHederaTokenService.FixedFee[](1);
        fixedFees[0] = IHederaTokenService.FixedFee(1, fixedFeeTokenAddress, false, false, treasury);

        IHederaTokenService.FractionalFee[] memory fractionalFees = new IHederaTokenService.FractionalFee[](1);
        fractionalFees[0] = IHederaTokenService.FractionalFee(4, 5, 10, 30, false, treasury);

        (int responseCode, address tokenAddress) =
        HederaTokenService.createFungibleTokenWithCustomFees(token, initialTotalSupply, decimals, fixedFees, fractionalFees);
        emit ResponseCode(responseCode);

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert ();
        }

        emit CreatedToken(tokenAddress);
    }

    function getTokenCustomFeesPublic(address token) public returns (
        int64 responseCode,
        IHederaTokenService.FixedFee[] memory fixedFees,
        IHederaTokenService.FractionalFee[] memory fractionalFees,
        IHederaTokenService.RoyaltyFee[] memory royaltyFees) {
        (responseCode, fixedFees, fractionalFees, royaltyFees) = HederaTokenService.getTokenCustomFees(token);
        emit ResponseCode(responseCode);

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert();
        }

        emit TokenCustomFees(fixedFees, fractionalFees, royaltyFees);
    }

    function deleteTokenPublic(address token) public returns (int responseCode) {
        responseCode = HederaTokenService.deleteToken(token);
        emit ResponseCode(responseCode);

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert();
        }
    }

    function getTokenDefaultKycStatusPublic(address token) public returns (int responseCode, bool defaultKycStatus) {
        (responseCode, defaultKycStatus) = HederaTokenService.getTokenDefaultKycStatus(token);

        emit ResponseCode(responseCode);

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert();
        }

        emit TokenDefaultKycStatus(defaultKycStatus);
    }

    function isKycPublic(address token, address account) external returns (int64 responseCode, bool kycGranted){
        (responseCode, kycGranted) = this.isKyc(token, account);

        emit ResponseCode(responseCode);

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert();
        }

        emit KycGranted(kycGranted);
    }

    function revokeTokenKycPublic(address token, address account) external returns (int64 responseCode){
        (responseCode) = this.revokeTokenKyc(token, account);

        emit ResponseCode(responseCode);

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert();
        }
    }
}