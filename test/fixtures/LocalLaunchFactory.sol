// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Local integration fixture only. No public deployment is needed or intended.
contract LocalLaunchFactory {
    event LaunchCreated(
        uint256 indexed launchId, address indexed launcher, address indexed token,
        address curve, string name, string symbol, string metadataURI, address pairCurrency,
        uint16 taxBps, uint64 packedWeights, address projectTreasury, uint256 targetPairUnits,
        uint256 netPersonal, uint256 giftNetTotal, bytes32 giftRoot, uint256 giftCount
    );
    function deploy() external returns(address token) {
        token=address(new LocalToken(msg.sender));
        emit LaunchCreated(1, msg.sender, token, token, "Local browser project", "LOCAL", "", address(0), 0, 0, msg.sender, 0, 0, 0, bytes32(0), 0);
    }
    function launch(address token) external {
        emit LaunchCreated(1, msg.sender, token, token, "Local fixture", "LOCAL", "", address(0), 0, 0, msg.sender, 0, 0, 0, bytes32(0), 0);
    }
}

/// @dev Minimal ERC20 views and constructor transfer for the deterministic browser journey.
contract LocalToken {
    string public constant name = "Local browser project";
    string public constant symbol = "LOCAL";
    uint8 public constant decimals = 18;
    uint256 public constant totalSupply = 1000 ether;
    address public owner;
    mapping(address => uint256) public balanceOf;
    event Transfer(address indexed from,address indexed to,uint256 value);
    constructor(address creator) { owner=creator; balanceOf[creator]=totalSupply; emit Transfer(address(0),creator,totalSupply); }
}
contract LocalMulticall3 {
    struct Call3 { address target; bool allowFailure; bytes callData; }
    struct Result { bool success; bytes returnData; }
    function aggregate3(Call3[] calldata calls) external payable returns(Result[] memory results) {
        results=new Result[](calls.length);
        for(uint256 i; i<calls.length; ++i) {
            (bool ok,bytes memory data)=calls[i].target.call(calls[i].callData);
            require(ok || calls[i].allowFailure,"call failed"); results[i]=Result(ok,data);
        }
    }
}
