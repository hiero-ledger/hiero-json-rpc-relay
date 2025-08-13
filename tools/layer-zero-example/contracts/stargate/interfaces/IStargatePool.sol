// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import { IStargate, SendParam, MessagingReceipt, MessagingFee, OFTReceipt } from "./IStargate.sol";

/// @title An interface for Stargate Pools
/// @notice Stargate Pools are a type of IStargate that allows users to pool token liquidity.
interface IStargatePool is IStargate {
    /// @notice Deposit token into the pool
    /// @param _receiver The account to mint the LP tokens to
    /// @param _amountLD The amount of tokens to deposit in LD
    /// @return amountLD The actual amount of tokens deposited in LD
    function deposit(address _receiver, uint256 _amountLD) external payable returns (uint256 amountLD);

    /// @notice Redeem an amount of LP tokens from the senders account, claiming rewards.
    /// @param _amountLD The amount of LP tokens to redeem
    /// @param _receiver The account to transfer the
    function redeem(uint256 _amountLD, address _receiver) external returns (uint256 amountLD);

    /// @notice Get how many LP tokens are redeemable for a given account
    /// @param _owner The address of the account to check
    /// @return amountLD The amount of LP tokens redeemable, in LD
    function redeemable(address _owner) external view returns (uint256 amountLD);

    /// @notice Redeem LP tokens and send the withdrawn tokens to a destination endpoint.
    /// @param _sendParam The SendParam payload describing the redeem and send
    /// @param _fee The MessagingFee to perform redeemSend
    /// @param _refundAddress The address to refund excess LayerZero messaging fees.
    /// @return receipt The MessagingReceipt describing the result of redeemSend
    /// @return oftReceipt The OFTReceipt describing the result of redeemSend
    function redeemSend(
        SendParam calldata _sendParam,
        MessagingFee calldata _fee,
        address _refundAddress
    ) external payable returns (MessagingReceipt memory receipt, OFTReceipt memory oftReceipt);

    /// @notice Quote the messaging fee for a redeemSend operation
    /// @param _sendParam The SendParam payload describing the redeem and send
    /// @param _payInLzToken Whether to pay the fee in LZ token
    /// @return messagingFee The MessagingFee for the redeemSend operation
    function quoteRedeemSend(
        SendParam calldata _sendParam,
        bool _payInLzToken
    ) external view returns (MessagingFee memory messagingFee);

    /// @notice Get the Total Value Locked in the pool.
    /// @return The total value locked
    function tvl() external view returns (uint256);

    /// @notice Get the available balance of the pool
    function poolBalance() external view returns (uint256);

    /// @notice Get the address of the LP token
    /// @return The address of the LP token contract.
    function lpToken() external view returns (address);
}
