// SPDX-License-Identifier: MIT

pragma solidity ^0.8.4;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/math/SafeMath.sol";


// ExampleToken with Governance.
contract DelayedJobs is Ownable {
    using SafeMath for uint;

    address public userA;
    address public userB;
    uint public delay;
    mapping (bytes32 => bool) public submittedTxs;
    mapping (bytes32 => uint256) public submittedTimes;
    mapping (bytes32 => uint256) public submittedBestBid;
    mapping (bytes32 => address) public submittedBestBidder;

    uint public constant MIN_DELAY = 1 hours;
    uint public constant MAX_DELAY = 48 hours;

    event DelayUpdate(uint indexed newDelay);
    event JobSubmitted(bytes32 indexed txHash, address indexed target, uint value, string signature, bytes data);
    event JobExecuted(bytes32 indexed txHash, address indexed target, uint value, string signature,  bytes data);

    /// @notice Construct the contract with administrator `admin_` and seconds `delay_`.
    constructor(address userA_, address userB_, uint delay_) {
        require(delay_ >= MIN_DELAY, "DelayedJobs::constructor: Delay must exceed min");
        require(delay_ <= MAX_DELAY, "DelayedJobs::constructor: Delay must not exceed max");

        (userA, userB, delay) = (userA_, userB_, delay_);
    }

    function updateDelay(uint delay_) public {
        require(msg.sender == userA, "DelayedJobs::updateDelay: Call must come from userA.");
        require(delay_ >= MIN_DELAY, "DelayedJobs::updateDelay: Delay must exceed min");
        require(delay_ <= MAX_DELAY, "DelayedJobs::updateDelay: Delay must not exceed max");
        delay = delay_;

        emit DelayUpdate(delay);
    }

    function identity() public {
    }

    function submitJob(address target, string memory signature, bytes memory data) public payable returns (bytes32) {
            require(msg.sender == userA, "DelayedJobs::submitJob: Call must come from userA.");
            require(msg.value > 0, "DelayedJobs::submitJob: Must include an ETH reward.");

            bytes32 txHash = keccak256(abi.encode(target, msg.value, signature, data));
            submittedTxs[txHash] = true;
            submittedTimes[txHash] = block.timestamp;

            emit JobSubmitted(txHash, target, msg.value, signature, data);
            return txHash;
        }

    function executeJob(address target, uint value, string memory signature, bytes memory data) public payable returns (bytes memory) {
            require(msg.sender == userB, "DelayedJobs::executeJob: Call must come from userB.");

            bytes32 txHash = keccak256(abi.encode(target, value, signature, data));
            require(submittedTxs[txHash], "DelayedJobs::executeJob: Transaction hasn't been submitted.");
            require(block.timestamp >= submittedTimes[txHash]+delay, "DelayedJobs::executeJob: Transaction hasn't surpassed delay time.");

            submittedTxs[txHash] = false;
            submittedTimes[txHash] = 0;

            bytes memory callData;

            if (bytes(signature).length == 0) {
                callData = data;
            } else {
                callData = abi.encodePacked(bytes4(keccak256(bytes(signature))), data);
            }

            // solium-disable-next-line security/no-call-value
            (bool success, bytes memory returnData) = target.call{value: msg.value}(callData);
            require(success, "DelayedJobs::executeJob: Transaction execution reverted.");

            // Send ETH reward.
            (bool success2, ) = userB.call{value: value}("");
            require(success2, "DelayedJobs::executeJob: Send reward reverted.");

            emit JobExecuted(txHash, target, value, signature, data);

            return returnData;
        }

    function submitJobAuction(address target, string memory signature, bytes memory data, uint256 timeout) public payable returns (bytes32) {
            require(msg.sender == userA, "DelayedJobs::submitJobAuction: Call must come from userA.");
            require(msg.value > 0, "DelayedJobs::submitJobAuction: Must include an ETH reward.");
            require(timeout > MIN_DELAY, "DelayedJobs::submitJobAuction: Timeout must be great than 1 hour");

            // now msg.value sent by userA is the maximum reward to be paid.
            bytes32 txHash = keccak256(abi.encode(target, msg.value, signature, data, timeout));
            submittedTxs[txHash] = true;
            submittedTimes[txHash] = block.timestamp;
            submittedBestBid[txHash] = msg.value;

            emit JobSubmitted(txHash, target, msg.value, signature, data);
            return txHash;
        }

    function placeJobBid(address target, uint maxBid, uint bid, string memory signature, bytes memory data, uint256 timeout) public payable returns (bytes32) {
            require(msg.sender != userA, "DelayedJobs::placeJobBid: Call must not come from userA.");

            bytes32 txHash = keccak256(abi.encode(target, maxBid, signature, data, timeout));
            require(submittedTxs[txHash], "DelayedJobs::placeJobBid: Transaction has not been submitted.");
            require(block.timestamp < submittedTimes[txHash]+delay, "DelayedJobs::placeJobBid: Transaction cannot surpass delay time.");
            require(submittedBestBid[txHash] > bid, "DelayedJobs::placeJobBid: Bid must be positive and smaller than best bid" );
            require(msg.value == maxBid - bid, "DelayedJobs::placeJobBid: Collateral must be diff with max bid." );
            
            if (submittedBestBid[txHash] < maxBid) {
                // refund previous bidder if prev best exists
                uint256 prevCollateral = maxBid - submittedBestBid[txHash];
                (bool success, ) = submittedBestBidder[txHash].call{value: prevCollateral}("");
                require( success, "refund failed");
            }
            submittedBestBid[txHash] = bid;
            submittedBestBidder[txHash] = msg.sender;

            return txHash;
        }

    function executeJobBid(address target, uint maxBid, string memory signature, bytes memory data, uint256 timeout) public returns (bytes memory) {
            require(msg.sender != userA, "DelayedJobs::executeJobBid: Call must not come from userA.");

            bytes32 txHash = keccak256(abi.encode(target, maxBid, signature, data, timeout));
            require(submittedTxs[txHash], "DelayedJobs::executeJobBid: Transaction hasn't been submitted.");
            require(block.timestamp < submittedTimes[txHash]+delay+timeout, "DelayedJobs::executeJobBid: Transaction has surpassed delay+timeout time.");
            require(block.timestamp >= submittedTimes[txHash]+delay, "DelayedJobs::executeJobBid: Transaction has not surpassed delay time.");
            require(submittedBestBidder[txHash] == msg.sender, "DelayedJobs::executeJobBid: Sender is best bidder." );
            
            submittedTxs[txHash] = false;
            submittedTimes[txHash] = 0;
            
            // refund bidder collateral + bid = (maxBid-bid) + bid = maxBid
            (bool success, ) = submittedBestBidder[txHash].call{value: maxBid}("");
            require( success, "transfer reward failed");
            // refund userA (maxBid-bid)
            (bool success_, ) = userA.call{value: maxBid-submittedBestBid[txHash]}("");
            require( success_, "transfer diff to userA failed");

            submittedBestBid[txHash] = 0;
            submittedBestBidder[txHash] = address(0);

            bytes memory callData;

            if (bytes(signature).length == 0) {
                callData = data;
            } else {
                callData = abi.encodePacked(bytes4(keccak256(bytes(signature))), data);
            }

            // solium-disable-next-line security/no-call-value
            (bool _success, bytes memory returnData) = target.call(callData);
            require(_success, "DelayedJobs::executeJobBid: Transaction execution reverted.");

            return returnData;
        }

    function cancelJobAuction(address target, uint256 maxBid, string memory signature, bytes memory data, uint256 timeout) public returns (bytes32) {
            require(msg.sender == userA, "DelayedJobs::submitJobAuction: Call must come from userA.");

            bytes32 txHash = keccak256(abi.encode(target, maxBid, signature, data, timeout));
            require(submittedTxs[txHash], "DelayedJobs::executeJobBid: Transaction hasn't been submitted or already executed.");
            require(block.timestamp >= submittedTimes[txHash]+delay+timeout, "DelayedJobs::cancelJobAuction: Cancelling only after delay+timeout");
            
            submittedTxs[txHash] = false;
            submittedTimes[txHash] = 0;
            submittedBestBid[txHash] = 0;
            submittedBestBidder[txHash] = address(0);

            // refund userA (maxBid)
            (bool success, ) = userA.call{value: maxBid}("");
            require( success, "transfer total reward back to userA failed");

            return txHash;
        }




}