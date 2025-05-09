// SPDX-License-Identifier: Apache-2.0
pragma solidity >=0.5.0 <0.9.0;
pragma experimental ABIEncoderV2;

/// Mocks HederaTokenService
abstract contract HederaTokenServiceMock {
    int32 constant SUCCESS_CODE = 22;

    /// Mocks the precompile call
    function mintToken(address token, int64 amount, bytes[] memory metadata) internal returns (
        int responseCode, int64 newTotalSupply, int64[] memory serialNumbers) {
        return (SUCCESS_CODE, int64(0), new int64[](0));
    }

    /// Mocks the precompile call
    function burnToken(
        address token,
        int64 amount,
        int64[] memory serialNumbers
    ) internal returns (int responseCode, int64 newTotalSupply) {
        return (SUCCESS_CODE, int64(0));
    }

    /// Mocks the precompile call
    function transferToken(address token, address sender, address receiver, int64 amount) internal returns (int responseCode) {
        return SUCCESS_CODE;
    }
}
