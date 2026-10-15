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
        Sold,       // buyer paid, ownership transferred
        Reserved,   // buyer's payment is held in escrow, product is locked
        Revoked     // a reservation was cancelled and the payment returned
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

    /// Result of re-checking one stored record.
    struct RecordInspection {
        Record record;            // the record as stored
        bytes32 recomputedHash;   // hash recomputed from the stored fields
        bytes32 expectedPrevHash; // hash of the stored record before it (GENESIS_HASH for #0)
        bool dataOk;              // recomputedHash == record.hash
        bool linkOk;              // record.prevHash == expectedPrevHash
    }

    // ───────────────────────────── Events ────────────────────────────

    /// @notice Emitted for every ledger record.
    /// @dev Carries both halves of the hash link (`prevHash` and `hash`). The
    ///      transaction log cannot be edited after the fact, so it is an
    ///      independent witness against which stored records can be audited.
    ///      `actor` is indexed so one account's activity is a cheap log filter.
    event RecordAppended(
        uint256 indexed index,
        uint256 indexed productId,
        Action action,
        address indexed actor,
        bytes32 prevHash,
        bytes32 hash
    );

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

    /// @notice Re-check one record and report *why* it is or isn't valid.
    /// @dev Unlike {verifyLedger} this never stops at the first problem, so it
    ///      can be called on any record to learn whether its data or its link is wrong.
    function inspectRecord(uint256 index) external view returns (RecordInspection memory);

    /// @notice List every broken record in [fromIndex, toIndex), with the reason.
    /// @dev `reasons[i]` is a bitmask for `brokenIndexes[i]`:
    ///      1 = data mismatch (stored hash != recomputed hash),
    ///      2 = link mismatch (prevHash != hash of the record before).
    ///      Unlike {verifyRange}, which stops at the first broken record, this
    ///      reports all of them. Keep ranges to a few hundred records to stay
    ///      within the gas cap of an `eth_call`.
    function auditRange(uint256 fromIndex, uint256 toIndex)
        external
        view
        returns (uint256[] memory brokenIndexes, uint8[] memory reasons);
}
