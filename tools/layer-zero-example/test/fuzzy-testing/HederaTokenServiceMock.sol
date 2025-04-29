// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/HTSConnector.sol";
import "../../contracts/hts/IHederaTokenService.sol";
import "../../contracts/hts/KeyHelper.sol";

/**
 * @title HederaTokenServiceMock
 * @dev Mock implementation of the IHederaTokenService interface for testing purposes.
 */
contract HederaTokenServiceMock is IHederaTokenService {
    int64 public constant SUCCESS_CODE = 22; // As per IHederaTokenService comments

    // Internal state variables to simulate token behavior (optional)
    mapping(address => int64) public totalSupply;
    mapping(address => mapping(address => int64)) public balances;

    /**
     * @notice Mints tokens to the treasury account.
     * @param token The token address.
     * @param amount The amount to mint (applicable to FUNGIBLE_COMMON).
     * @param metadata The metadata for NFTs (ignored in this mock).
     * @return responseCode Always returns SUCCESS_CODE.
     * @return newTotalSupply The new total supply after minting.
     * @return serialNumbers Always returns an empty array for fungible tokens.
     */
    function mintToken(
        HederaToken memory token,
        int64 amount,
        bytes[] memory metadata
    )
        external
        override
        returns (
            int64 responseCode,
            int64 newTotalSupply,
            int64[] memory serialNumbers
        )
    {
        // Simulate minting by increasing totalSupply
        totalSupply[token.treasury] += amount;

        // In a real implementation, you would handle metadata for NFTs
        // Here, we return an empty array for simplicity
        serialNumbers = new int64[](0);

        return (SUCCESS_CODE, totalSupply[token.treasury], serialNumbers);
    }

    /**
     * @notice Burns tokens from the treasury account.
     * @param token The token address.
     * @param amount The amount to burn (applicable to FUNGIBLE_COMMON).
     * @param serialNumbers The serial numbers to burn (ignored in this mock).
     * @return responseCode Always returns SUCCESS_CODE.
     * @return newTotalSupply The new total supply after burning.
     */
    function burnToken(
        address token,
        int64 amount,
        int64[] memory serialNumbers
    )
        external
        override
        returns (int64 responseCode, int64 newTotalSupply)
    {
        // Simulate burning by decreasing totalSupply
        totalSupply[token] -= amount;

        return (SUCCESS_CODE, totalSupply[token]);
    }

    /**
     * @notice Creates a new fungible token.
     * @param token The HederaToken struct containing token properties.
     * @param initialTotalSupply The initial total supply of the token.
     * @param decimals The number of decimal places the token is divisible by.
     * @return responseCode Always returns SUCCESS_CODE.
     * @return tokenAddress Always returns a mock token address (e.g., address(0x1)).
     */
    function createFungibleToken(
        HederaToken memory token,
        int64 initialTotalSupply,
        int32 decimals
    )
        external
        payable
        override
        returns (int64 responseCode, address tokenAddress)
    {
        // Simulate token creation by setting initialTotalSupply
        totalSupply[token.treasury] = initialTotalSupply;

        // Return a mock token address
        tokenAddress = address(0x1);

        return (SUCCESS_CODE, tokenAddress);
    }

    /**
     * @notice Transfers tokens between accounts.
     * @param token The token address.
     * @param sender The address sending the tokens.
     * @param recipient The address receiving the tokens.
     * @param amount The amount of tokens to transfer.
     * @return responseCode Always returns SUCCESS_CODE.
     */
    function transferToken(
        address token,
        address sender,
        address recipient,
        int64 amount
    )
        external
        override
        returns (int64 responseCode)
    {
        // Simulate transfer by updating balances
        balances[token][sender] -= amount;
        balances[token][recipient] += amount;

        return SUCCESS_CODE;
    }

    /**
     * @notice Updates the keys associated with a token.
     * @param token The token address.
     * @param keys The array of TokenKey structs to update.
     * @return responseCode Always returns SUCCESS_CODE.
     */
    function updateTokenKeys(address token, TokenKey[] memory keys)
        external
        override
        returns (int64 responseCode)
    {
        // In a real implementation, you would update the token's keys.
        // Here, we simply return SUCCESS_CODE.

        return SUCCESS_CODE;
    }

    // Optional: Additional helper functions to simulate behavior

    /**
     * @notice Retrieves the balance of a specific account for a given token.
     * @param token The token address.
     * @param account The account address.
     * @return The balance of the account.
     */
    function balanceOf(address token, address account) external view returns (int64) {
        return balances[token][account];
    }
}
