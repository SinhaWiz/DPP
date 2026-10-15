// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IBuySellTraceability} from "./interfaces/IBuySellTraceability.sol";
import {HashChainLedger} from "./HashChainLedger.sol";

/**
 * @title BuySellTraceability
 * @notice A simple buy/sell marketplace. Every action is appended to a
 *         hash-linked ledger (see {HashChainLedger}) so the full provenance of
 *         any product can be traced and independently verified.
 */
contract BuySellTraceability is IBuySellTraceability, HashChainLedger {
    // ───────────────────────────── State ─────────────────────────────

    uint256 public override productCount;
    mapping(uint256 productId => Product) private _products;

    // ──────────────────────────── Modifiers ──────────────────────────

    modifier onlyProductOwner(uint256 productId) {
        if (_product(productId).owner != msg.sender) revert NotProductOwner(productId, msg.sender);
        _;
    }

    // ───────────────────────────── Actions ───────────────────────────

    /// @inheritdoc IBuySellTraceability
    function registerProduct(string calldata name) external override returns (uint256 productId) {
        if (bytes(name).length == 0) revert EmptyName();

        productId = ++productCount;
        _products[productId] = Product({id: productId, name: name, owner: msg.sender, price: 0});

        _appendRecord(productId, Action.Registered, msg.sender, address(0), 0);
        emit ProductRegistered(productId, msg.sender, name);
    }

    /// @inheritdoc IBuySellTraceability
    function listForSale(uint256 productId, uint256 price) external override onlyProductOwner(productId) {
        if (price == 0) revert InvalidPrice();

        _products[productId].price = price;

        _appendRecord(productId, Action.Listed, msg.sender, address(0), price);
        emit ProductListed(productId, msg.sender, price);
    }

    /// @inheritdoc IBuySellTraceability
    function cancelListing(uint256 productId) external override onlyProductOwner(productId) {
        Product storage product = _products[productId];
        if (!_isListed(product)) revert NotListed(productId);

        _clearListing(product);

        _appendRecord(productId, Action.Delisted, msg.sender, address(0), 0);
        emit ProductDelisted(productId, msg.sender);
    }

    /// @inheritdoc IBuySellTraceability
    /// @dev Checks-effects-interactions: state and ledger are updated before
    ///      the ETH is forwarded to the seller.
    function buy(uint256 productId) external payable override {
        Product storage product = _product(productId);
        _requirePurchasable(product);

        address seller = product.owner;
        uint256 price = product.price;

        _transferOwnership(product, msg.sender);
        _appendRecord(productId, Action.Sold, seller, msg.sender, price);
        emit ProductSold(productId, seller, msg.sender, price);

        _pay(seller, price);
    }

    // ───────────────────────────── Views ─────────────────────────────

    /// @inheritdoc IBuySellTraceability
    function getProduct(uint256 productId) external view override returns (Product memory) {
        return _product(productId);
    }

    /// @inheritdoc IBuySellTraceability
    function getProducts(uint256 offset, uint256 limit) external view override returns (Product[] memory page) {
        uint256 total = productCount;
        if (offset >= total) return page;

        uint256 remaining = total - offset;
        uint256 count = limit < remaining ? limit : remaining;

        page = new Product[](count);
        for (uint256 i = 0; i < count; i++) {
            page[i] = _products[offset + i + 1];
        }
    }

    /// @inheritdoc IBuySellTraceability
    function isForSale(uint256 productId) external view override returns (bool) {
        return _isListed(_product(productId));
    }

    /// @inheritdoc IBuySellTraceability
    function getProductHistoryLength(uint256 productId) external view override returns (uint256) {
        _product(productId);
        return _historyLength(productId);
    }

    /// @inheritdoc IBuySellTraceability
    function getProductHistory(uint256 productId, uint256 offset, uint256 limit)
        external
        view
        override
        returns (Record[] memory)
    {
        _product(productId);
        return _historyPage(productId, offset, limit);
    }

    // ──────────────────────────── Internals ──────────────────────────

    /// @dev Returns the product, reverting if the id was never registered.
    function _product(uint256 productId) private view returns (Product storage product) {
        if (productId == 0 || productId > productCount) revert ProductNotFound(productId);
        product = _products[productId];
    }

    function _isListed(Product storage product) private view returns (bool) {
        return product.price > 0;
    }

    function _clearListing(Product storage product) private {
        product.price = 0;
    }

    /// @dev Reverts unless the caller may buy this product with the attached ETH.
    function _requirePurchasable(Product storage product) private view {
        if (!_isListed(product)) revert NotListed(product.id);
        if (msg.sender == product.owner) revert CannotBuyOwnProduct(product.id);
        if (msg.value != product.price) revert IncorrectPayment(product.price, msg.value);
    }

    /// @dev Hands the product to `newOwner`; a sale always ends the listing.
    function _transferOwnership(Product storage product, address newOwner) private {
        product.owner = newOwner;
        _clearListing(product);
    }

    function _pay(address recipient, uint256 amount) private {
        (bool ok, ) = payable(recipient).call{value: amount}("");
        if (!ok) revert PaymentFailed(recipient);
    }
}
