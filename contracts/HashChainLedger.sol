// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ITraceabilityLedger} from "./interfaces/ITraceabilityLedger.sol";

/**
 * @title HashChainLedger
 * @notice Append-only ledger in which every record stores the hash of the
 *         record before it. Altering any past record changes its hash and
 *         breaks every link after it, which `verifyLedger` / `verifyRange`
 *         detect.
 * @dev Inheriting contracts append records through `_appendRecord` and expose
 *      per-product history through `_historyLength` / `_historyPage`.
 */
abstract contract HashChainLedger is ITraceabilityLedger {
    /// `prevHash` of the first record.
    bytes32 internal constant GENESIS_HASH = bytes32(0);

    /// Bit flags returned by {auditRange}.
    uint8 public constant REASON_DATA = 1;
    uint8 public constant REASON_LINK = 2;

    Record[] private _ledger;
    mapping(uint256 productId => uint256[] ledgerIndexes) private _indexesByProduct;

    // ─────────────────────────── Read API ────────────────────────────

    /// @inheritdoc ITraceabilityLedger
    function ledgerLength() external view override returns (uint256) {
        return _ledger.length;
    }

    /// @inheritdoc ITraceabilityLedger
    function getRecord(uint256 index) external view override returns (Record memory) {
        if (index >= _ledger.length) revert RecordNotFound(index);
        return _ledger[index];
    }

    /// @inheritdoc ITraceabilityLedger
    function getRecords(uint256 offset, uint256 limit) external view override returns (Record[] memory page) {
        uint256 length = _ledger.length;
        if (offset >= length) return page;

        uint256 remaining = length - offset;
        uint256 count = limit < remaining ? limit : remaining;

        page = new Record[](count);
        for (uint256 i = 0; i < count; i++) {
            page[i] = _ledger[offset + i];
        }
    }

    /// @inheritdoc ITraceabilityLedger
    function headHash() external view override returns (bytes32) {
        return _headHash();
    }

    /// @inheritdoc ITraceabilityLedger
    function verifyLedger() external view override returns (bool valid, uint256 brokenAt) {
        return _verify(0, _ledger.length);
    }

    /// @inheritdoc ITraceabilityLedger
    function verifyRange(uint256 fromIndex, uint256 toIndex)
        external
        view
        override
        returns (bool valid, uint256 brokenAt)
    {
        if (fromIndex > toIndex || toIndex > _ledger.length) revert InvalidRange(fromIndex, toIndex);
        return _verify(fromIndex, toIndex);
    }

    /// @inheritdoc ITraceabilityLedger
    function inspectRecord(uint256 index) external view override returns (RecordInspection memory result) {
        if (index >= _ledger.length) revert RecordNotFound(index);
        result.record = _ledger[index];
        (result.dataOk, result.linkOk, result.recomputedHash, result.expectedPrevHash) = _check(index);
    }

    /// @inheritdoc ITraceabilityLedger
    function auditRange(uint256 fromIndex, uint256 toIndex)
        external
        view
        override
        returns (uint256[] memory brokenIndexes, uint8[] memory reasons)
    {
        if (fromIndex > toIndex || toIndex > _ledger.length) revert InvalidRange(fromIndex, toIndex);

        uint256 maxCount = toIndex - fromIndex;
        brokenIndexes = new uint256[](maxCount);
        reasons = new uint8[](maxCount);

        uint256 found;
        for (uint256 i = fromIndex; i < toIndex; i++) {
            (bool dataOk, bool linkOk, , ) = _check(i);
            if (dataOk && linkOk) continue;
            brokenIndexes[found] = i;
            reasons[found] = (dataOk ? 0 : REASON_DATA) | (linkOk ? 0 : REASON_LINK);
            found++;
        }

        // Shrink both arrays to the number of broken records.
        assembly {
            mstore(brokenIndexes, found)
            mstore(reasons, found)
        }
    }

    // ──────────────────────────── Internals ──────────────────────────

    /// @dev Appends a record linked to the current head of the chain.
    function _appendRecord(
        uint256 productId,
        Action action,
        address actor,
        address counterparty,
        uint256 price
    ) internal {
        uint256 index = _ledger.length;

        Record memory record = Record({
            index: index,
            timestamp: block.timestamp,
            productId: productId,
            action: action,
            actor: actor,
            counterparty: counterparty,
            price: price,
            prevHash: _headHash(),
            hash: bytes32(0)
        });
        record.hash = _computeHash(record);

        _ledger.push(record);
        _indexesByProduct[productId].push(index);
        emit RecordAppended(index, productId, action, record.hash);
    }

    function _historyLength(uint256 productId) internal view returns (uint256) {
        return _indexesByProduct[productId].length;
    }

    /// @dev Returns up to `limit` records of a product, skipping `offset`.
    ///      Out-of-range offsets yield an empty page instead of reverting.
    function _historyPage(uint256 productId, uint256 offset, uint256 limit)
        internal
        view
        returns (Record[] memory page)
    {
        uint256[] storage indexes = _indexesByProduct[productId];
        if (offset >= indexes.length) return page;

        uint256 remaining = indexes.length - offset;
        uint256 count = limit < remaining ? limit : remaining;

        page = new Record[](count);
        for (uint256 i = 0; i < count; i++) {
            page[i] = _ledger[indexes[offset + i]];
        }
    }

    function _headHash() private view returns (bytes32) {
        return _ledger.length == 0 ? GENESIS_HASH : _ledger[_ledger.length - 1].hash;
    }

    /// @dev Stateless check of one stored record against the stored record before it.
    function _check(uint256 index)
        private
        view
        returns (bool dataOk, bool linkOk, bytes32 recomputedHash, bytes32 expectedPrevHash)
    {
        Record memory record = _ledger[index];
        expectedPrevHash = index == 0 ? GENESIS_HASH : _ledger[index - 1].hash;
        recomputedHash = _computeHash(record);
        dataOk = recomputedHash == record.hash;
        linkOk = record.prevHash == expectedPrevHash;
    }

    function _verify(uint256 fromIndex, uint256 toIndex) private view returns (bool, uint256) {
        for (uint256 i = fromIndex; i < toIndex; i++) {
            (bool dataOk, bool linkOk, , ) = _check(i);
            if (!dataOk || !linkOk) return (false, i);
        }
        return (true, 0);
    }

    function _computeHash(Record memory r) private pure returns (bytes32) {
        return keccak256(
            abi.encode(r.index, r.timestamp, r.productId, r.action, r.actor, r.counterparty, r.price, r.prevHash)
        );
    }
}
