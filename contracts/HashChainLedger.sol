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

    function _verify(uint256 fromIndex, uint256 toIndex) private view returns (bool, uint256) {
        bytes32 expectedPrev = fromIndex == 0 ? GENESIS_HASH : _ledger[fromIndex - 1].hash;
        for (uint256 i = fromIndex; i < toIndex; i++) {
            Record storage record = _ledger[i];
            if (record.prevHash != expectedPrev || record.hash != _computeHash(record)) {
                return (false, i);
            }
            expectedPrev = record.hash;
        }
        return (true, 0);
    }

    function _computeHash(Record memory r) private pure returns (bytes32) {
        return keccak256(
            abi.encode(r.index, r.timestamp, r.productId, r.action, r.actor, r.counterparty, r.price, r.prevHash)
        );
    }
}
