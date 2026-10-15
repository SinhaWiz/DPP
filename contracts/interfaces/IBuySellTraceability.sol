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

    /// A buyer's payment held in escrow while the seller decides.
    struct Reservation {
        address buyer;     // address(0) means "no reservation"
        uint256 amount;    // wei held by the contract
        uint64 expiresAt;  // after this time anyone may expire the reservation
    }

    /// Why a reservation ended without a sale.
    enum RevocationReason {
        BuyerCancelled,
        SellerRejected,
        Expired
    }

    // ───────────────────────────── Events ────────────────────────────

    event ProductRegistered(uint256 indexed productId, address indexed owner, string name);
    event ProductListed(uint256 indexed productId, address indexed owner, uint256 price);
    event ProductDelisted(uint256 indexed productId, address indexed owner);
    event ProductSold(uint256 indexed productId, address indexed seller, address indexed buyer, uint256 price);
    event ReservationCreated(uint256 indexed productId, address indexed buyer, uint256 amount, uint64 expiresAt);
    event ReservationRevoked(
        uint256 indexed productId, address indexed by, address indexed buyer, uint256 amount, RevocationReason reason
    );
    event SaleConfirmed(uint256 indexed productId, address indexed seller, address indexed buyer, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);

    // ───────────────────────────── Errors ────────────────────────────

    error EmptyName();
    error InvalidPrice();
    error ProductNotFound(uint256 productId);
    error NotProductOwner(uint256 productId, address caller);
    error NotListed(uint256 productId);
    error CannotBuyOwnProduct(uint256 productId);
    error IncorrectPayment(uint256 expected, uint256 sent);
    error PaymentFailed(address recipient);
    error ProductReserved(uint256 productId);
    error NotReserved(uint256 productId);
    error NotReservationBuyer(uint256 productId, address caller);
    error ReservationExpired(uint256 productId, uint64 expiredAt);
    error ReservationNotExpired(uint256 productId, uint64 expiresAt);
    error NothingToWithdraw(address account);
    error WithdrawFailed(address account);

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

    // ─────────────────────── Escrow purchase flow ────────────────────

    /// @notice Reserve a listed product by depositing exactly its price. The
    ///         ETH is held by the contract and the product is locked until the
    ///         seller confirms, someone revokes, or the reservation expires.
    function reserve(uint256 productId) external payable;

    /// @notice Seller accepts a reservation within its period: ownership
    ///         moves to the buyer and the payment becomes withdrawable by the seller.
    function confirmSale(uint256 productId) external;

    /// @notice The reserving buyer cancels. The deposit becomes withdrawable by the buyer.
    function revokeReservation(uint256 productId) external;

    /// @notice The seller declines a reservation. The deposit becomes withdrawable by the buyer.
    function rejectReservation(uint256 productId) external;

    /// @notice Anyone may end a reservation whose period has passed.
    ///         The deposit becomes withdrawable by the buyer.
    function expireReservation(uint256 productId) external;

    /// @notice Pull the caller's withdrawable balance (sale proceeds or refunds).
    function withdraw() external;

    // ───────────────────────────── Views ─────────────────────────────

    /// @notice How long a reservation lasts before it can be expired.
    function RESERVATION_PERIOD() external view returns (uint64);

    /// @notice Wei an account can pull with {withdraw}.
    function pendingWithdrawals(address account) external view returns (uint256);

    /// @notice The reservation on a product (buyer == address(0) when none).
    function getReservation(uint256 productId) external view returns (Reservation memory);

    /// @notice Whether the product currently has a reservation.
    function isReserved(uint256 productId) external view returns (bool);

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
