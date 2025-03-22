// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.24;

contract WHBAR {
    string public name = "Wrapped HBAR";
    string public symbol = "WHBAR";
    uint8 public decimals = 8;
    uint256 private whbarTotalSupply = 0;

    event Approval(address indexed src, address indexed guy, uint wad);
    event Transfer(address indexed src, address indexed dst, uint wad);
    event Deposit(address indexed dst, uint wad);
    event Withdrawal(address indexed src, uint wad);

    error InsufficientFunds();
    error InsufficientAllowance();
    error SendFailed();

    mapping(address user => uint balance) public balanceOf;
    mapping(address owner => mapping(address spender => uint amount)) public allowance;

    fallback() external payable {
        deposit();
    }

    receive() external payable {
        deposit();
    }

    function deposit() public payable {
        balanceOf[msg.sender] += msg.value;
        whbarTotalSupply += msg.value;

        emit Deposit(msg.sender, msg.value);
    }

    function withdraw(uint wad) public {
        if (!(balanceOf[msg.sender] >= wad)) {
            revert InsufficientFunds();
        }

        balanceOf[msg.sender] -= wad;
        whbarTotalSupply -= wad;
        (bool success, ) = payable(msg.sender).call{value: wad}("");
        if (!success) {
            revert SendFailed();
        }

        emit Withdrawal(msg.sender, wad);
    }

    function totalSupply() public view returns (uint) {
        return whbarTotalSupply;
    }

    function approve(address guy, uint wad) public returns (bool) {
        allowance[msg.sender][guy] = wad;

        emit Approval(msg.sender, guy, wad);

        return true;
    }

    function transfer(address dst, uint wad) public returns (bool) {
        return transferFrom(msg.sender, dst, wad);
    }

    function transferFrom(address src, address dst, uint wad) public returns (bool) {
        if (dst == address(this)) {
            revert SendFailed();
        }

        if (!(balanceOf[src] >= wad)) {
            revert InsufficientFunds();
        }

        if (src != msg.sender && allowance[src][msg.sender] != type(uint256).max) {
            if (!(allowance[src][msg.sender] >= wad)) {
                revert InsufficientAllowance();
            }
            allowance[src][msg.sender] -= wad;
        }

        balanceOf[src] -= wad;
        balanceOf[dst] += wad;

        emit Transfer(src, dst, wad);

        return true;
    }
}
