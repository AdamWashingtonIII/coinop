// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title QTR — COINOP Quarter (ADR 0004, minter role added for automated claims)
/// @notice Arcade reward token on Base. Agents earn 25 QTR per paid 0.25 USDC play.
/// @dev Emission discipline lives in the arcade's rewards ledger: tokens are minted
///      ONLY against verified, settled plays (25 per play). The owner (the COINOP
///      treasury wallet) can mint without limit and can appoint ONE minter address —
///      the arcade's claim processor — which may mint up to MINTER_TX_CAP per call.
///      The minter holds no other power and can be revoked by the owner at any time
///      (setMinter(address(0))). This lets claims clear automatically without the
///      treasury key ever touching a server. No supply cap in-contract — supply can
///      only grow through owner/minter mints, each of which must correspond to
///      accrued rewards in the ledger. No burn, no taxes, no trading tricks: a plain
///      ERC-20 so any agent wallet can hold it.
contract QTR is ERC20, Ownable {
    /// @notice Hard per-transaction cap for the appointed minter: 1,000 QTR.
    uint256 public constant MINTER_TX_CAP = 1000 * 10 ** 18;

    address public minter;

    event MinterSet(address indexed minter);

    constructor(address treasury) ERC20("COINOP Quarter", "QTR") Ownable(treasury) {}

    /// @notice Appoint or revoke the claim-processor minter. Owner only.
    function setMinter(address newMinter) external onlyOwner {
        minter = newMinter;
        emit MinterSet(newMinter);
    }

    /// @notice Mint accrued play rewards to a wallet.
    /// @dev Owner mints freely; the appointed minter is capped per transaction.
    function mint(address to, uint256 amount) external {
        if (msg.sender == owner()) {
            _mint(to, amount);
        } else if (msg.sender == minter && minter != address(0)) {
            require(amount <= MINTER_TX_CAP, "QTR: minter cap exceeded");
            _mint(to, amount);
        } else {
            revert OwnableUnauthorizedAccount(msg.sender);
        }
    }
}
