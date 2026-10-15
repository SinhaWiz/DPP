// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IBuySellTraceability} from "../interfaces/IBuySellTraceability.sol";

/// @dev Test helper: tries to call `withdraw()` again from inside its own
///      payout, to prove a re-entering receiver cannot be paid twice.
contract ReentrantWithdrawer {
    IBuySellTraceability public immutable market;
    uint256 public reentries;
    bool public reentrySucceeded;

    constructor(address market_) {
        market = IBuySellTraceability(market_);
    }

    function registerAndList(uint256 price) external {
        market.registerProduct("Reentrant item");
        market.listForSale(market.productCount(), price);
    }

    function confirm(uint256 productId) external {
        market.confirmSale(productId);
    }

    function attack() external {
        market.withdraw();
    }

    receive() external payable {
        reentries++;
        try market.withdraw() {
            reentrySucceeded = true;
        } catch {}
    }
}
