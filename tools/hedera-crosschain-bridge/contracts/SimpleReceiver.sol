// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.0;

/**
 * @title SimpleReceiver
 * @dev A minimal contract that can receive tokens/ETH
 * Used as a test receiver for cross-chain transfers
 */
contract SimpleReceiver {
    /**
     * @dev Allows the contract to receive ETH/HBAR/tokens
     */
    receive() external payable {}
    
    /**
     * @dev Fallback function to receive ETH/HBAR/tokens
     */
    fallback() external payable {}
}
