// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IBuySellTraceability} from "../interfaces/IBuySellTraceability.sol";

/// @dev Test helper: a seller contract that cannot receive ETH.
contract EtherRejecter {
    function registerOn(address market) external {
        IBuySellTraceability(market).registerProduct("Rejecter's item");
    }

    function list(address market, uint256 productId, uint256 price) external {
        IBuySellTraceability(market).listForSale(productId, price);
    }
}
