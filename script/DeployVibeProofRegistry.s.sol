// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VibeProofRegistry} from "../contracts/VibeProofRegistry.sol";

/// Usage (key held in an encrypted Foundry keystore, never in env or source):
///   cast wallet import vibeproof-deployer --interactive
///   forge script script/DeployVibeProofRegistry.s.sol:DeployVibeProofRegistry \
///     --rpc-url robinhood_testnet --account vibeproof-deployer --broadcast
contract DeployVibeProofRegistry is Script {
    function run() external returns (VibeProofRegistry registry) {
        require(block.chainid == 46630, "Expected Robinhood Chain Testnet (46630)");
        vm.startBroadcast();
        registry = new VibeProofRegistry();
        vm.stopBroadcast();
        console2.log("VibeProofRegistry deployed at", address(registry));
    }
}
