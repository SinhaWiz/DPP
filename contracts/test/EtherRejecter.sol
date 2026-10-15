// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IBuySellTraceability} from "../interfaces/IBuySellTraceability.sol";

/// @dev Test helper: a contract account that cannot receive ETH, usable as a seller or a buyer.
contract EtherRejecter {
    function registerOn(address market) external {
        IBuySellTraceability(market).registerProduct("Rejecter's item");
    }

    function list(address market, uint256 productId, uint256 price) external {
        IBuySellTraceability(market).listForSale(productId, price);
    }

    /// @dev Reserve a product as a buyer; this contract still cannot receive ETH back.
    function reserveOn(address market, uint256 productId) external payable {
        IBuySellTraceability(market).reserve{value: msg.value}(productId);
    }

    function withdrawFrom(address market) external {
        IBuySellTraceability(market).withdraw();
    }
}
