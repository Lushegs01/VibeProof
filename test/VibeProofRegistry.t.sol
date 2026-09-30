// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {VibeProofRegistry} from "../contracts/VibeProofRegistry.sol";

contract DummyToken {}

contract VibeProofRegistryTest is Test {
    VibeProofRegistry registry;
    address token;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    bytes32 constant H1 = keccak256("proof-v1");
    bytes32 constant H2 = keccak256("proof-v2");
    string constant URI1 = "https://vibeproof.xyz/api/tokens/0x1/proof";
    string constant URI2 = "ipfs://bafy-updated";

    event ProofSubmitted(address indexed creator, address indexed token, bytes32 indexed metadataHash, string metadataURI);
    event ProofUpdated(address indexed creator, address indexed token, bytes32 indexed metadataHash, string metadataURI);

    function setUp() public {
        registry = new VibeProofRegistry();
        token = address(new DummyToken());
        vm.warp(1_790_000_000);
    }

    // ── submitProof ─────────────────────────────────────────────
    function test_submitProof_storesRecordAndEmits() public {
        vm.expectEmit(true, true, true, true, address(registry));
        emit ProofSubmitted(alice, token, H1, URI1);
        vm.prank(alice);
        registry.submitProof(token, H1, URI1);

        VibeProofRegistry.Proof memory p = registry.getProof(alice, token);
        assertEq(p.creator, alice);
        assertEq(p.token, token);
        assertEq(p.metadataHash, H1);
        assertEq(p.metadataURI, URI1);
        assertEq(p.createdAt, 1_790_000_000);
        assertEq(p.updatedAt, 1_790_000_000);
        assertTrue(registry.hasProof(alice, token));
        assertEq(registry.submitterCount(token), 1);
    }

    function test_submitProof_revertsOnDuplicate() public {
        vm.startPrank(alice);
        registry.submitProof(token, H1, URI1);
        vm.expectRevert(VibeProofRegistry.ProofAlreadyExists.selector);
        registry.submitProof(token, H2, URI2);
        vm.stopPrank();
    }

    function test_submitProof_isKeyedBySender() public {
        vm.prank(alice);
        registry.submitProof(token, H1, URI1);
        vm.prank(bob);
        registry.submitProof(token, H2, URI2);
        assertEq(registry.getProof(alice, token).metadataHash, H1);
        assertEq(registry.getProof(bob, token).metadataHash, H2);
        address[] memory s = registry.submitters(token, 0, 10);
        assertEq(s.length, 2);
        assertEq(s[0], alice);
        assertEq(s[1], bob);
    }

    function test_submitProof_revertsOnZeroToken() public {
        vm.expectRevert(VibeProofRegistry.ZeroToken.selector);
        registry.submitProof(address(0), H1, URI1);
    }

    function test_submitProof_revertsOnEOAToken() public {
        vm.expectRevert(VibeProofRegistry.TokenNotContract.selector);
        registry.submitProof(bob, H1, URI1);
    }

    function test_submitProof_revertsOnZeroHash() public {
        vm.expectRevert(VibeProofRegistry.ZeroMetadataHash.selector);
        registry.submitProof(token, bytes32(0), URI1);
    }

    function test_submitProof_revertsOnEmptyURI() public {
        vm.expectRevert(VibeProofRegistry.EmptyMetadataURI.selector);
        registry.submitProof(token, H1, "");
    }

    function test_submitProof_revertsOnLongURI() public {
        bytes memory long = new bytes(513);
        for (uint256 i; i < long.length; ++i) long[i] = "a";
        vm.expectRevert(VibeProofRegistry.MetadataURITooLong.selector);
        registry.submitProof(token, H1, string(long));
    }

    function test_submitProof_acceptsMaxLengthURI() public {
        bytes memory max = new bytes(512);
        for (uint256 i; i < max.length; ++i) max[i] = "a";
        registry.submitProof(token, H1, string(max));
        assertEq(bytes(registry.getProof(address(this), token).metadataURI).length, 512);
    }

    // ── updateProof ─────────────────────────────────────────────
    function test_updateProof_updatesAndEmits() public {
        vm.prank(alice);
        registry.submitProof(token, H1, URI1);
        vm.warp(1_790_000_500);
        vm.expectEmit(true, true, true, true, address(registry));
        emit ProofUpdated(alice, token, H2, URI2);
        vm.prank(alice);
        registry.updateProof(token, H2, URI2);

        VibeProofRegistry.Proof memory p = registry.getProof(alice, token);
        assertEq(p.metadataHash, H2);
        assertEq(p.metadataURI, URI2);
        assertEq(p.createdAt, 1_790_000_000);
        assertEq(p.updatedAt, 1_790_000_500);
        assertEq(registry.submitterCount(token), 1, "update must not duplicate submitter");
    }

    function test_updateProof_revertsWithoutExisting() public {
        vm.prank(alice);
        vm.expectRevert(VibeProofRegistry.ProofNotFound.selector);
        registry.updateProof(token, H1, URI1);
    }

    function test_updateProof_cannotTouchOthersRecord() public {
        vm.prank(alice);
        registry.submitProof(token, H1, URI1);
        vm.prank(bob);
        vm.expectRevert(VibeProofRegistry.ProofNotFound.selector);
        registry.updateProof(token, H2, URI2);
        assertEq(registry.getProof(alice, token).metadataHash, H1);
    }

    function test_updateProof_revertsWhenUnchanged() public {
        vm.startPrank(alice);
        registry.submitProof(token, H1, URI1);
        vm.expectRevert(VibeProofRegistry.UnchangedProof.selector);
        registry.updateProof(token, H1, URI1);
        vm.stopPrank();
    }

    function test_updateProof_allowsUriOnlyChange() public {
        vm.startPrank(alice);
        registry.submitProof(token, H1, URI1);
        registry.updateProof(token, H1, URI2);
        vm.stopPrank();
        assertEq(registry.getProof(alice, token).metadataURI, URI2);
    }

    function test_updateProof_validatesInputs() public {
        vm.startPrank(alice);
        registry.submitProof(token, H1, URI1);
        vm.expectRevert(VibeProofRegistry.ZeroMetadataHash.selector);
        registry.updateProof(token, bytes32(0), URI1);
        vm.expectRevert(VibeProofRegistry.EmptyMetadataURI.selector);
        registry.updateProof(token, H2, "");
        vm.stopPrank();
    }

    // ── getProof / views ────────────────────────────────────────
    function test_getProof_revertsWhenMissing() public {
        vm.expectRevert(VibeProofRegistry.ProofNotFound.selector);
        registry.getProof(alice, token);
        assertFalse(registry.hasProof(alice, token));
    }

    function test_submitters_pagination() public {
        for (uint160 i = 1; i <= 5; ++i) {
            vm.prank(address(i * 1000));
            registry.submitProof(token, H1, URI1);
        }
        assertEq(registry.submitters(token, 0, 2).length, 2);
        assertEq(registry.submitters(token, 4, 10).length, 1);
        assertEq(registry.submitters(token, 5, 10).length, 0);
        assertEq(registry.submitters(token, 3, 2)[1], address(5000));
    }

    // ── no custody / no hidden permissions ──────────────────────
    function test_rejectsEther() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(registry).call{value: 1 wei}("");
        assertFalse(ok);
        assertEq(address(registry).balance, 0);
    }

    function test_rejectsEtherOnSubmit() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(registry).call{value: 1 wei}(abi.encodeCall(VibeProofRegistry.submitProof, (token, H1, URI1)));
        assertFalse(ok, "submitProof must be non-payable");
    }

    // ── fuzz ────────────────────────────────────────────────────
    function testFuzz_submitThenGet(address creator, bytes32 h, string calldata uri) public {
        vm.assume(h != bytes32(0));
        vm.assume(bytes(uri).length > 0 && bytes(uri).length <= 512);
        vm.prank(creator);
        registry.submitProof(token, h, uri);
        VibeProofRegistry.Proof memory p = registry.getProof(creator, token);
        assertEq(p.creator, creator);
        assertEq(p.metadataHash, h);
        assertEq(keccak256(bytes(p.metadataURI)), keccak256(bytes(uri)));
    }
}
