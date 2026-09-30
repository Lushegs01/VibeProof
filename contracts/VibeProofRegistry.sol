// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title VibeProofRegistry
/// @notice A minimal, permissionless anchoring primitive. A creator commits the
///         keccak256 hash of their project-proof metadata (plus a URI where the
///         full document lives) for a token. Nothing else.
///
/// Design notes
///  - No owner, no admin, no roles, no upgradeability, no pause. There is no
///    privileged key whose compromise could alter or censor records.
///  - Holds no tokens and no ETH (non-payable, no receive/fallback).
///  - Stores no subjective statements ("safe", "legit", ...). Only: creator,
///    token, metadata hash, metadata URI, timestamps.
///  - Records are keyed by (msg.sender, token). Anyone can anchor a record for
///    any token; consumers (e.g. VibeProof) decide whose records matter, e.g. by
///    matching `creator` against the launcher recorded in the launch event.
contract VibeProofRegistry {
    struct Proof {
        address creator;
        address token;
        bytes32 metadataHash;
        string metadataURI;
        uint64 createdAt;
        uint64 updatedAt;
    }

    uint256 public constant MAX_URI_LENGTH = 512;

    mapping(address creator => mapping(address token => Proof)) private _proofs;
    mapping(address token => address[]) private _submitters;

    event ProofSubmitted(address indexed creator, address indexed token, bytes32 indexed metadataHash, string metadataURI);
    event ProofUpdated(address indexed creator, address indexed token, bytes32 indexed metadataHash, string metadataURI);

    error ZeroToken();
    error TokenNotContract();
    error ZeroMetadataHash();
    error EmptyMetadataURI();
    error MetadataURITooLong();
    error ProofAlreadyExists();
    error ProofNotFound();
    error UnchangedProof();

    /// @notice Anchor a new proof for `token`. One record per (sender, token).
    function submitProof(address token, bytes32 metadataHash, string calldata metadataURI) external {
        _validate(token, metadataHash, metadataURI);
        Proof storage p = _proofs[msg.sender][token];
        if (p.createdAt != 0) revert ProofAlreadyExists();

        uint64 nowTs = uint64(block.timestamp);
        p.creator = msg.sender;
        p.token = token;
        p.metadataHash = metadataHash;
        p.metadataURI = metadataURI;
        p.createdAt = nowTs;
        p.updatedAt = nowTs;
        _submitters[token].push(msg.sender);

        emit ProofSubmitted(msg.sender, token, metadataHash, metadataURI);
    }

    /// @notice Replace the hash/URI of the caller's existing proof for `token`.
    function updateProof(address token, bytes32 metadataHash, string calldata metadataURI) external {
        _validate(token, metadataHash, metadataURI);
        Proof storage p = _proofs[msg.sender][token];
        if (p.createdAt == 0) revert ProofNotFound();
        if (p.metadataHash == metadataHash && keccak256(bytes(p.metadataURI)) == keccak256(bytes(metadataURI))) revert UnchangedProof();

        p.metadataHash = metadataHash;
        p.metadataURI = metadataURI;
        p.updatedAt = uint64(block.timestamp);

        emit ProofUpdated(msg.sender, token, metadataHash, metadataURI);
    }

    /// @notice Returns the proof `creator` anchored for `token`. Reverts if none.
    function getProof(address creator, address token) external view returns (Proof memory) {
        Proof memory p = _proofs[creator][token];
        if (p.createdAt == 0) revert ProofNotFound();
        return p;
    }

    function hasProof(address creator, address token) external view returns (bool) {
        return _proofs[creator][token].createdAt != 0;
    }

    function submitterCount(address token) external view returns (uint256) {
        return _submitters[token].length;
    }

    /// @notice Paginated list of addresses that anchored a proof for `token`.
    function submitters(address token, uint256 offset, uint256 limit) external view returns (address[] memory page) {
        address[] storage all = _submitters[token];
        if (offset >= all.length) return new address[](0);
        uint256 end = offset + limit > all.length ? all.length : offset + limit;
        page = new address[](end - offset);
        for (uint256 i = offset; i < end; ++i) page[i - offset] = all[i];
    }

    function _validate(address token, bytes32 metadataHash, string calldata metadataURI) private view {
        if (token == address(0)) revert ZeroToken();
        if (token.code.length == 0) revert TokenNotContract();
        if (metadataHash == bytes32(0)) revert ZeroMetadataHash();
        uint256 len = bytes(metadataURI).length;
        if (len == 0) revert EmptyMetadataURI();
        if (len > MAX_URI_LENGTH) revert MetadataURITooLong();
    }
}
