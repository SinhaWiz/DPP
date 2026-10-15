// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITraceabilityLedger} from "./ITraceabilityLedger.sol";

/**
 * @title IBuySellTraceability
 * @notice Public API of the buy/sell marketplace with a traceable ledger.
 */
interface IBuySellTraceability is ITraceabilityLedger {
    // ───────────────────────────── Types ─────────────────────────────

    struct Product {
        uint256 id;
        string name;
        address owner;
        uint256 price; 
    }

    // ───────────────────────────── Events ────────────────────────────

    event ProductRegistered(uint256 indexed productId, address indexed owner, string name);
    event ProductListed(uint256 indexed productId, address indexed owner, uint256 price);
    event ProductDelisted(uint256 indexed productId, address indexed owner);
    event ProductSold(uint256 indexed productId, address indexed seller, address indexed buyer, uint256 price);

    // ───────────────────────────── Errors ────────────────────────────

    error EmptyName();
    error InvalidPrice();
    error ProductNotFound(uint256 productId);
    error NotProductOwner(uint256 productId, address caller);
    error NotListed(uint256 productId);
    error CannotBuyOwnProduct(uint256 productId);
    error IncorrectPayment(uint256 expected, uint256 sent);
    error PaymentFailed(address recipient);

    // ───────────────────────────── Actions ───────────────────────────

    /// @notice Register a new product. The caller becomes its first owner.
    /// @param name Human-readable product name (must not be empty)
    /// @return productId Id of the new product
    function registerProduct(string calldata name) external returns (uint256 productId);

    /// @notice Put an owned product up for sale (or change its price).
    /// @param productId Product to list
    /// @param price Price in wei (must be > 0)
    function listForSale(uint256 productId, uint256 price) external;

    /// @notice Withdraw a listing.
    /// @param productId Product to delist
    function cancelListing(uint256 productId) external;

    /// @notice Buy a listed product by sending exactly its price in ETH.
    /// @param productId Product to buy
    function buy(uint256 productId) external payable;

    // ───────────────────────────── Views ─────────────────────────────

    /// @notice Number of products registered so far (also the latest product id).
    function productCount() external view returns (uint256);

    /// @notice Details of one product.
    function getProduct(uint256 productId) external view returns (Product memory);

    /// @notice A page of products in id order (ids start at 1).
    /// @dev Out-of-range offsets yield an empty page; `limit` is clamped.
    /// @param offset Number of products to skip (offset 0 starts at product #1)
    /// @param limit Maximum number of products to return
    function getProducts(uint256 offset, uint256 limit) external view returns (Product[] memory);

    /// @notice Whether the product is currently listed for sale.
    function isForSale(uint256 productId) external view returns (bool);

    /// @notice Number of ledger records that concern one product.
    function getProductHistoryLength(uint256 productId) external view returns (uint256);

    /// @notice A page of one product's trail, oldest first.
    /// @param productId Product to trace
    /// @param offset Number of records to skip
    /// @param limit Maximum number of records to return
    function getProductHistory(uint256 productId, uint256 offset, uint256 limit)
        external
        view
        returns (Record[] memory);
}
