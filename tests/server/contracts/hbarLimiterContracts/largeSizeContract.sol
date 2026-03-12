// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.5.0 <0.9.0;
pragma experimental ABIEncoderV2;

import "../FeeHelper.sol";

contract BaseHTS is FeeHelper {

    string name = "tokenName";
    string symbol = "tokenSymbol";
    string memo = "memo";
    uint initialTotalSupply = 1000;
    uint32 maxSupply = 1000;
    uint decimals = 8;

    event CreatedToken(address tokenAddress);

    function createToken(
        address treasury
    ) public payable {
        IHederaTokenService.TokenKey[] memory keys = new IHederaTokenService.TokenKey[](1);
        keys[0] = getSingleKey(0, 0, 1, bytes(""));

        IHederaTokenService.Expiry memory expiry = IHederaTokenService.Expiry(
            0, treasury, 8000000
        );

        IHederaTokenService.HederaToken memory token = IHederaTokenService.HederaToken(
            name, symbol, treasury, memo, true, maxSupply, false, keys, expiry
        );

        (int responseCode, address tokenAddress) =
        HederaTokenService.createFungibleToken(token, initialTotalSupply, decimals);

        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert ();
        }

        emit CreatedToken(tokenAddress);
    }

    function associateTokenTo(address account, address token) public returns (int responseCode) {
        responseCode = HederaTokenService.associateToken(account, token);
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert();
        }
    }

    function transferTokenTo(address account, address token, int64 amount) public returns (int responseCode) {
        IHederaTokenService.NftTransfer[] memory nftTransfers = new IHederaTokenService.NftTransfer[](0);

        IHederaTokenService.AccountAmount memory accountAmountNegative =
        IHederaTokenService.AccountAmount(msg.sender, - amount);
        IHederaTokenService.AccountAmount memory accountAmountPositive =
        IHederaTokenService.AccountAmount(account, amount);
        IHederaTokenService.AccountAmount[] memory transfers = new IHederaTokenService.AccountAmount[](2);
        transfers[0] = accountAmountNegative;
        transfers[1] = accountAmountPositive;

        IHederaTokenService.TokenTransferList memory tokenTransfer =
        IHederaTokenService.TokenTransferList(token, transfers, nftTransfers);
        IHederaTokenService.TokenTransferList[] memory tokenTransferList = new IHederaTokenService.TokenTransferList[](1);
        tokenTransferList[0] = tokenTransfer;

        responseCode = HederaTokenService.cryptoTransfer(tokenTransferList);
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert();
        }
    }

    function transferTokenFrom(address account, address token, int64 amount) public returns (int responseCode) {
        IHederaTokenService.NftTransfer[] memory nftTransfers = new IHederaTokenService.NftTransfer[](0);

        IHederaTokenService.AccountAmount memory accountAmountNegative =
        IHederaTokenService.AccountAmount(msg.sender, - amount);
        IHederaTokenService.AccountAmount memory accountAmountPositive =
        IHederaTokenService.AccountAmount(account, amount);
        IHederaTokenService.AccountAmount[] memory transfers = new IHederaTokenService.AccountAmount[](2);
        transfers[0] = accountAmountNegative;
        transfers[1] = accountAmountPositive;

        IHederaTokenService.TokenTransferList memory tokenTransfer =
        IHederaTokenService.TokenTransferList(token, transfers, nftTransfers);
        IHederaTokenService.TokenTransferList[] memory tokenTransferList = new IHederaTokenService.TokenTransferList[](1);
        tokenTransferList[0] = tokenTransfer;

        responseCode = HederaTokenService.cryptoTransfer(tokenTransferList);
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert();
        }
    }

    function transferFrom(address account, address token, int64 amount) public returns (int responseCode) {
        IHederaTokenService.NftTransfer[] memory nftTransfers = new IHederaTokenService.NftTransfer[](0);

        IHederaTokenService.AccountAmount memory accountAmountNegative =
        IHederaTokenService.AccountAmount(msg.sender, - amount);
        IHederaTokenService.AccountAmount memory accountAmountPositive =
        IHederaTokenService.AccountAmount(account, amount);
        IHederaTokenService.AccountAmount[] memory transfers = new IHederaTokenService.AccountAmount[](2);
        transfers[0] = accountAmountNegative;
        transfers[1] = accountAmountPositive;

        IHederaTokenService.TokenTransferList memory tokenTransfer =
        IHederaTokenService.TokenTransferList(token, transfers, nftTransfers);
        IHederaTokenService.TokenTransferList[] memory tokenTransferList = new IHederaTokenService.TokenTransferList[](1);
        tokenTransferList[0] = tokenTransfer;

        responseCode = HederaTokenService.cryptoTransfer(tokenTransferList);
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert();
        }
    }

    function transferTo(address account, address token, int64 amount) public returns (int responseCode) {
        IHederaTokenService.NftTransfer[] memory nftTransfers = new IHederaTokenService.NftTransfer[](0);

        IHederaTokenService.AccountAmount memory accountAmountNegative =
        IHederaTokenService.AccountAmount(msg.sender, - amount);
        IHederaTokenService.AccountAmount memory accountAmountPositive =
        IHederaTokenService.AccountAmount(account, amount);
        IHederaTokenService.AccountAmount[] memory transfers = new IHederaTokenService.AccountAmount[](2);
        transfers[0] = accountAmountNegative;
        transfers[1] = accountAmountPositive;

        IHederaTokenService.TokenTransferList memory tokenTransfer =
        IHederaTokenService.TokenTransferList(token, transfers, nftTransfers);
        IHederaTokenService.TokenTransferList[] memory tokenTransferList = new IHederaTokenService.TokenTransferList[](1);
        tokenTransferList[0] = tokenTransfer;

        responseCode = HederaTokenService.cryptoTransfer(tokenTransferList);
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert();
        }
    }

    function sendTo(address account, address token, int64 amount) public returns (int responseCode) {
        IHederaTokenService.NftTransfer[] memory nftTransfers = new IHederaTokenService.NftTransfer[](0);

        IHederaTokenService.AccountAmount memory accountAmountNegative =
        IHederaTokenService.AccountAmount(msg.sender, - amount);
        IHederaTokenService.AccountAmount memory accountAmountPositive =
        IHederaTokenService.AccountAmount(account, amount);
        IHederaTokenService.AccountAmount[] memory transfers = new IHederaTokenService.AccountAmount[](2);
        transfers[0] = accountAmountNegative;
        transfers[1] = accountAmountPositive;

        IHederaTokenService.TokenTransferList memory tokenTransfer =
        IHederaTokenService.TokenTransferList(token, transfers, nftTransfers);
        IHederaTokenService.TokenTransferList[] memory tokenTransferList = new IHederaTokenService.TokenTransferList[](1);
        tokenTransferList[0] = tokenTransfer;

        responseCode = HederaTokenService.cryptoTransfer(tokenTransferList);
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert();
        }
    }

    function sendFrom(address account, address token, int64 amount) public returns (int responseCode) {
        IHederaTokenService.NftTransfer[] memory nftTransfers = new IHederaTokenService.NftTransfer[](0);

        IHederaTokenService.AccountAmount memory accountAmountNegative =
        IHederaTokenService.AccountAmount(msg.sender, - amount);
        IHederaTokenService.AccountAmount memory accountAmountPositive =
        IHederaTokenService.AccountAmount(account, amount);
        IHederaTokenService.AccountAmount[] memory transfers = new IHederaTokenService.AccountAmount[](2);
        transfers[0] = accountAmountNegative;
        transfers[1] = accountAmountPositive;

        IHederaTokenService.TokenTransferList memory tokenTransfer =
        IHederaTokenService.TokenTransferList(token, transfers, nftTransfers);
        IHederaTokenService.TokenTransferList[] memory tokenTransferList = new IHederaTokenService.TokenTransferList[](1);
        tokenTransferList[0] = tokenTransfer;

        responseCode = HederaTokenService.cryptoTransfer(tokenTransferList);
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert();
        }
    }
    function getTokenInformation(address token) public returns (int responseCode, IHederaTokenService.TokenInfo memory tokenInfo) {
        (responseCode, tokenInfo) = HederaTokenService.getTokenInfo(token);
        if (responseCode != HederaResponseCodes.SUCCESS) {
            revert();
        }
        return (responseCode, tokenInfo);
    }
}
