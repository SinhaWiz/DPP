// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ITraceabilityLedger
 * @notice Types, events, errors and read API of a hash-linked traceability ledger.
 */
interface ITraceabilityLedger {
    // ───────────────────────────── Types ─────────────────────────────

    enum Action {
        Registered, // product created, creator becomes first owner
        Listed,     // owner put product up for sale at a price
        Delisted,   // owner withdrew the listing
        Sold        // buyer paid, ownership transferred
    }

    /// One "block" in the ledger.
    struct Record {
        uint256 index;        // position in the ledger
        uint256 timestamp;    // block.timestamp when it was written
        uint256 productId;
        Action action;
        address actor;        // who performed the action (the seller for Sold)
        address counterparty; // the buyer for Sold, address(0) for every other action
        uint256 price;        // price involved in wei (0 when not applicable)
        bytes32 prevHash;     // hash of the previous record (GENESIS_HASH for the first)
        bytes32 hash;         // keccak256 over all fields above
    }

    // ───────────────────────────── Events ────────────────────────────

    event RecordAppended(uint256 indexed index, uint256 indexed productId, Action action, bytes32 hash);

    // ───────────────────────────── Errors ────────────────────────────

    error RecordNotFound(uint256 index);
    error InvalidRange(uint256 fromIndex, uint256 toIndex);

    // ─────────────────────────── Read API ────────────────────────────

    /// @notice Number of records in the ledger.
    function ledgerLength() external view returns (uint256);

    /// @notice A single ledger record.
    function getRecord(uint256 index) external view returns (Record memory);

    /// @notice A page of the ledger, oldest first.
    /// @dev Out-of-range offsets yield an empty page and `limit` is clamped to
    ///      what is available, so a huge `limit` is safe.
    /// @param offset Number of records to skip
    /// @param limit Maximum number of records to return
    function getRecords(uint256 offset, uint256 limit) external view returns (Record[] memory);

    /// @notice Hash of the newest record, or the all-zero genesis hash for an empty ledger.
    /// @dev This is the `prevHash` the next record will carry.
    function headHash() external view returns (bytes32);

    /// @notice Verify every hash and link in the whole ledger.
    /// @return valid true if the chain is intact
    /// @return brokenAt index of the first bad record (only meaningful if !valid)
    function verifyLedger() external view returns (bool valid, uint256 brokenAt);

    /// @notice Verify records in the half-open range [fromIndex, toIndex).
    /// @dev The first record's link is checked against the stored hash of the
    ///      record before it; that earlier record is not itself re-hashed.
    function verifyRange(uint256 fromIndex, uint256 toIndex)
        external
        view
        returns (bool valid, uint256 brokenAt);
}
