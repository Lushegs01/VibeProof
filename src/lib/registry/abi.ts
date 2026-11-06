import { parseAbi } from "viem";

export const REGISTRY_ABI = parseAbi([
  "function submitProof(address token, bytes32 metadataHash, string metadataURI)",
  "function updateProof(address token, bytes32 metadataHash, string metadataURI)",
  "function getProof(address creator, address token) view returns ((address creator, address token, bytes32 metadataHash, string metadataURI, uint64 createdAt, uint64 updatedAt))",
  "function hasProof(address creator, address token) view returns (bool)",
  "event ProofSubmitted(address indexed creator, address indexed token, bytes32 indexed metadataHash, string metadataURI)",
  "event ProofUpdated(address indexed creator, address indexed token, bytes32 indexed metadataHash, string metadataURI)",
]);
