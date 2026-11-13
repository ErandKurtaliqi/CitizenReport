// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

interface IServiceRegistry {
    function aiOracle() external view returns (address);
    function owner() external view returns (address);
    function isCategoryActive(uint256 id) external view returns (bool);
    function isAuthorizedContractor(address account) external view returns (bool);
    function roleOf(address account) external view returns (uint8);
    function slaHoursOf(uint256 id) external view returns (uint32);
}

contract ServiceRequestWorkflow is EIP712 {
    // Disputed shtohet në fund që statuset e versionit 1 të ruajnë numrat e tyre.
    enum Status { Submitted, Categorized, Assigned, InProgress, WorkSubmitted, Verified, Rejected, Cancelled, Disputed }
    // Versioni 3: vlerësimi i "syrit të tretë" (AI), i nënshkruar nga oracle-i.
    enum AiVerdict { None, Resolved, NotResolved, Inconclusive }

    struct AiAssessment {
        AiVerdict verdict;
        uint8 confidence;      // 0-100
        bool sameLocation;
        string reportCid;      // raporti i plotë i AI-së në IPFS
        bytes32 proofHash;     // keccak256(workProofCid): vlerësimi vlen vetëm për këtë dëshmi
        uint64 assessedAt;
    }

    bytes32 private constant AI_TYPEHASH = keccak256(
        "AiAssessment(uint256 requestId,bytes32 proofHash,uint8 verdict,uint8 confidence,bool sameLocation,bytes32 reportHash,uint256 deadline)"
    );

    struct ServiceRequest {
        uint256 id;
        address citizen;
        uint256 categoryId;
        address contractor;
        Status status;
        string descriptionCid;
        string locationHash;
        string workProofCid;
        uint8 rating;
        uint64 createdAt;
        uint64 assignedAt;
        uint64 closedAt;
    }

    // Të dhënat e versionit 2 mbahen veçmas, që ABI e getRequests() të mbetet e pandryshuar.
    struct RequestMeta {
        address assignedBy;
        address verifiedBy;
        uint64 dueAt;
        bool escalated;
        uint8 disputeCount;
        string disputeCid;
    }

    uint8 private constant ROLE_OPERATOR = 1;
    uint8 private constant ROLE_SUPERVISOR = 2;
    uint64 public constant TRIAGE_HOURS = 48;
    uint64 public constant DISPUTE_WINDOW = 7 days;
    uint8 public constant MAX_DISPUTES = 2;

    IServiceRegistry public immutable registry;
    uint256 public requestCount;
    mapping(uint256 => ServiceRequest) private requests;
    mapping(uint256 => RequestMeta) private metas;
    mapping(uint256 => AiAssessment) private aiAssessments;

    event RequestSubmitted(uint256 indexed requestId, address indexed citizen, string descriptionCid);
    event RequestCategorized(uint256 indexed requestId, uint256 indexed categoryId);
    event ContractorAssigned(uint256 indexed requestId, address indexed contractor);
    event WorkStarted(uint256 indexed requestId, address indexed contractor);
    event WorkProofSubmitted(uint256 indexed requestId, string proofCid);
    event RequestVerified(uint256 indexed requestId, address indexed municipality);
    event RequestRejected(uint256 indexed requestId, string reasonCid);
    event RequestCancelled(uint256 indexed requestId, address indexed citizen);
    event RequestRated(uint256 indexed requestId, uint8 rating);
    event RequestEscalated(uint256 indexed requestId, address indexed escalatedBy, uint64 overdueSeconds);
    event ResolutionDisputed(uint256 indexed requestId, address indexed citizen, string evidenceCid);
    event RequestReopened(uint256 indexed requestId, address indexed operator);
    event DisputeDismissed(uint256 indexed requestId, address indexed supervisor, string reasonCid);
    event AiAssessmentRecorded(uint256 indexed requestId, AiVerdict verdict, uint8 confidence, bool sameLocation, string reportCid);
    event AiVerdictOverridden(uint256 indexed requestId, address indexed supervisor, string reasonCid);

    error Unauthorized();
    error InvalidRequest();
    error InvalidStatus();
    error InvalidInput();
    error ClosedRequest();
    error SelfReview();
    error NotOverdue();
    error AlreadyEscalated();
    error DisputeWindowClosed();
    error InvalidSignature();
    error SignatureExpired();
    error OverrideReasonRequired();

    modifier onlyOperator() {
        if (registry.roleOf(msg.sender) != ROLE_OPERATOR) revert Unauthorized();
        _;
    }

    modifier onlySupervisor() {
        if (registry.roleOf(msg.sender) != ROLE_SUPERVISOR) revert Unauthorized();
        _;
    }

    modifier validRequest(uint256 id) {
        if (id == 0 || id > requestCount) revert InvalidRequest();
        _;
    }

    constructor(address registryAddress) EIP712("ServiceRequestWorkflow", "3") {
        if (registryAddress == address(0)) revert InvalidInput();
        registry = IServiceRegistry(registryAddress);
    }

    function submitRequest(string calldata descriptionCid, string calldata locationHash) external returns (uint256 id) {
        if (bytes(descriptionCid).length == 0 || bytes(locationHash).length == 0) revert InvalidInput();
        id = ++requestCount;
        requests[id] = ServiceRequest({
            id: id,
            citizen: msg.sender,
            categoryId: 0,
            contractor: address(0),
            status: Status.Submitted,
            descriptionCid: descriptionCid,
            locationHash: locationHash,
            workProofCid: "",
            rating: 0,
            createdAt: uint64(block.timestamp),
            assignedAt: 0,
            closedAt: 0
        });
        // Faza e pranimit: komuna duhet ta kategorizojë brenda TRIAGE_HOURS.
        metas[id].dueAt = uint64(block.timestamp) + TRIAGE_HOURS * 1 hours;
        emit RequestSubmitted(id, msg.sender, descriptionCid);
    }

    function categorizeRequest(uint256 id, uint256 categoryId) external onlyOperator validRequest(id) {
        ServiceRequest storage item = requests[id];
        if (item.status != Status.Submitted) revert InvalidStatus();
        if (!registry.isCategoryActive(categoryId)) revert InvalidInput();
        item.categoryId = categoryId;
        item.status = Status.Categorized;
        _startResolutionDeadline(id, categoryId);
        emit RequestCategorized(id, categoryId);
    }

    function assignContractor(uint256 id, address contractor) external onlyOperator validRequest(id) {
        ServiceRequest storage item = requests[id];
        if (item.status != Status.Categorized) revert InvalidStatus();
        if (!registry.isAuthorizedContractor(contractor)) revert Unauthorized();
        item.contractor = contractor;
        item.status = Status.Assigned;
        item.assignedAt = uint64(block.timestamp);
        metas[id].assignedBy = msg.sender;
        emit ContractorAssigned(id, contractor);
    }

    function startWork(uint256 id) external validRequest(id) {
        ServiceRequest storage item = requests[id];
        if (msg.sender != item.contractor) revert Unauthorized();
        if (item.status != Status.Assigned) revert InvalidStatus();
        item.status = Status.InProgress;
        emit WorkStarted(id, msg.sender);
    }

    function submitWorkProof(uint256 id, string calldata proofCid) external validRequest(id) {
        ServiceRequest storage item = requests[id];
        if (msg.sender != item.contractor) revert Unauthorized();
        if (item.status != Status.InProgress) revert InvalidStatus();
        if (bytes(proofCid).length == 0) revert InvalidInput();
        item.workProofCid = proofCid;
        item.status = Status.WorkSubmitted;
        emit WorkProofSubmitted(id, proofCid);
    }

    /// Mbikëqyrësi verifikon; ai që caktoi kontraktuesin nuk mund ta verifikojë punën.
    /// Nëse AI ka thënë "e pazgjidhur" për këtë dëshmi, duhet përdorur verifyAgainstAi me arsyetim.
    function verifyResolution(uint256 id) external onlySupervisor validRequest(id) {
        if (_currentAiVerdict(id) == AiVerdict.NotResolved) revert OverrideReasonRequired();
        _verify(id);
    }

    /// Verifikim kundër vlerësimit të AI-së: lejohet, por arsyetimi mbetet publik përgjithmonë.
    function verifyAgainstAi(uint256 id, string calldata reasonCid) external onlySupervisor validRequest(id) {
        if (_currentAiVerdict(id) != AiVerdict.NotResolved) revert InvalidStatus();
        if (bytes(reasonCid).length == 0) revert InvalidInput();
        _verify(id);
        emit AiVerdictOverridden(id, msg.sender, reasonCid);
    }

    /// Regjistron vlerësimin e AI-së. Kushdo mund ta dërgojë (relayer), por pranohet vetëm me nënshkrimin e oracle-it.
    function submitAiAssessment(
        uint256 id,
        AiVerdict verdict,
        uint8 confidence,
        bool sameLocation,
        string calldata reportCid,
        uint256 deadline,
        bytes calldata signature
    ) external validRequest(id) {
        if (requests[id].status != Status.WorkSubmitted) revert InvalidStatus();
        if (verdict == AiVerdict.None || confidence > 100 || bytes(reportCid).length == 0) revert InvalidInput();
        if (block.timestamp > deadline) revert SignatureExpired();
        bytes32 proofHash = keccak256(bytes(requests[id].workProofCid));
        _requireOracleSignature(
            aiAssessmentDigest(id, proofHash, verdict, confidence, sameLocation, keccak256(bytes(reportCid)), deadline),
            signature
        );
        AiAssessment storage a = aiAssessments[id];
        a.verdict = verdict;
        a.confidence = confidence;
        a.sameLocation = sameLocation;
        a.reportCid = reportCid;
        a.proofHash = proofHash;
        a.assessedAt = uint64(block.timestamp);
        emit AiAssessmentRecorded(id, verdict, confidence, sameLocation, reportCid);
    }

    function _requireOracleSignature(bytes32 digest, bytes calldata signature) private view {
        address oracle = registry.aiOracle();
        (address signer, ECDSA.RecoverError err, ) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError || oracle == address(0) || signer != oracle) revert InvalidSignature();
    }

    /// Hash-i EIP-712 që nënshkruan oracle-i (domain: emri, versioni, chainId, adresa e kontratës).
    function aiAssessmentDigest(
        uint256 id, bytes32 proofHash, AiVerdict verdict, uint8 confidence, bool sameLocation, bytes32 reportHash, uint256 deadline
    ) public view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(
            AI_TYPEHASH, id, proofHash, uint8(verdict), confidence, sameLocation, reportHash, deadline
        )));
    }

    function getAiAssessment(uint256 id) external view validRequest(id) returns (AiAssessment memory) {
        return aiAssessments[id];
    }

    /// Verdikti i AI-së vlen vetëm për dëshminë aktuale; pas rihapjes me dëshmi të re kthehet None.
    function currentAiVerdict(uint256 id) external view validRequest(id) returns (AiVerdict) {
        return _currentAiVerdict(id);
    }

    function _currentAiVerdict(uint256 id) private view returns (AiVerdict) {
        AiAssessment storage a = aiAssessments[id];
        if (a.verdict == AiVerdict.None) return AiVerdict.None;
        return a.proofHash == keccak256(bytes(requests[id].workProofCid)) ? a.verdict : AiVerdict.None;
    }

    function _verify(uint256 id) private {
        ServiceRequest storage item = requests[id];
        RequestMeta storage meta = metas[id];
        if (item.status != Status.WorkSubmitted) revert InvalidStatus();
        if (bytes(item.workProofCid).length == 0) revert InvalidInput();
        if (msg.sender == meta.assignedBy) revert SelfReview();
        item.status = Status.Verified;
        item.closedAt = uint64(block.timestamp);
        meta.verifiedBy = msg.sender;
        emit RequestVerified(id, msg.sender);
    }

    function rejectRequest(uint256 id, string calldata reasonCid) external onlyOperator validRequest(id) {
        ServiceRequest storage item = requests[id];
        if (item.status != Status.Submitted && item.status != Status.Categorized) revert InvalidStatus();
        if (bytes(reasonCid).length == 0) revert InvalidInput();
        item.status = Status.Rejected;
        item.workProofCid = reasonCid;
        item.closedAt = uint64(block.timestamp);
        emit RequestRejected(id, reasonCid);
    }

    function cancelRequest(uint256 id) external validRequest(id) {
        ServiceRequest storage item = requests[id];
        if (msg.sender != item.citizen) revert Unauthorized();
        if (item.status != Status.Submitted) revert InvalidStatus();
        item.status = Status.Cancelled;
        item.closedAt = uint64(block.timestamp);
        emit RequestCancelled(id, msg.sender);
    }

    function rateResolution(uint256 id, uint8 rating) external validRequest(id) {
        ServiceRequest storage item = requests[id];
        if (msg.sender != item.citizen) revert Unauthorized();
        if (item.status != Status.Verified) revert InvalidStatus();
        if (rating < 1 || rating > 5 || item.rating != 0) revert InvalidInput();
        item.rating = rating;
        emit RequestRated(id, rating);
    }

    /// Kushdo mund ta eskalojë publikisht një kërkesë të hapur që ka kaluar afatin.
    function escalate(uint256 id) external validRequest(id) {
        ServiceRequest storage item = requests[id];
        RequestMeta storage meta = metas[id];
        if (uint8(item.status) > uint8(Status.WorkSubmitted)) revert ClosedRequest();
        if (block.timestamp <= meta.dueAt) revert NotOverdue();
        if (meta.escalated) revert AlreadyEscalated();
        meta.escalated = true;
        emit RequestEscalated(id, msg.sender, uint64(block.timestamp) - meta.dueAt);
    }

    /// Qytetari konteston zgjidhjen brenda DISPUTE_WINDOW, me dëshmi të re në IPFS.
    function disputeResolution(uint256 id, string calldata evidenceCid) external validRequest(id) {
        ServiceRequest storage item = requests[id];
        RequestMeta storage meta = metas[id];
        if (msg.sender != item.citizen) revert Unauthorized();
        if (item.status != Status.Verified || item.rating != 0) revert InvalidStatus();
        if (block.timestamp > item.closedAt + DISPUTE_WINDOW) revert DisputeWindowClosed();
        if (meta.disputeCount >= MAX_DISPUTES || bytes(evidenceCid).length == 0) revert InvalidInput();
        meta.disputeCount++;
        meta.disputeCid = evidenceCid;
        item.status = Status.Disputed;
        emit ResolutionDisputed(id, msg.sender, evidenceCid);
    }

    /// Operatori e rihap kërkesën e kontestuar te i njëjti kontraktues; dëshmia e vjetër fshihet.
    function reopenRequest(uint256 id) external onlyOperator validRequest(id) {
        ServiceRequest storage item = requests[id];
        RequestMeta storage meta = metas[id];
        if (item.status != Status.Disputed) revert InvalidStatus();
        item.status = Status.Assigned;
        item.workProofCid = "";
        item.closedAt = 0;
        item.assignedAt = uint64(block.timestamp);
        meta.assignedBy = msg.sender;
        meta.verifiedBy = address(0);
        _startResolutionDeadline(id, item.categoryId);
        emit RequestReopened(id, msg.sender);
    }

    /// Një mbikëqyrës tjetër nga ai që verifikoi e hedh poshtë kontestimin me arsyetim.
    function dismissDispute(uint256 id, string calldata reasonCid) external onlySupervisor validRequest(id) {
        ServiceRequest storage item = requests[id];
        RequestMeta storage meta = metas[id];
        if (item.status != Status.Disputed) revert InvalidStatus();
        if (msg.sender == meta.verifiedBy) revert SelfReview();
        if (bytes(reasonCid).length == 0) revert InvalidInput();
        item.status = Status.Verified;
        emit DisputeDismissed(id, msg.sender, reasonCid);
    }

    function getRequest(uint256 id) external view validRequest(id) returns (ServiceRequest memory) {
        return requests[id];
    }

    function getRequestMeta(uint256 id) external view validRequest(id) returns (RequestMeta memory) {
        return metas[id];
    }

    function getRequests(uint256 offset, uint256 limit) external view returns (ServiceRequest[] memory page) {
        if (offset >= requestCount || limit == 0) return new ServiceRequest[](0);
        uint256 end = offset + limit;
        if (end > requestCount) end = requestCount;
        page = new ServiceRequest[](end - offset);
        for (uint256 i = offset; i < end; i++) page[i - offset] = requests[i + 1];
    }

    /// Afat i ri sipas SLA-së së kategorisë; eskalimi i fazës së mëparshme mbetet vetëm në evente.
    function _startResolutionDeadline(uint256 id, uint256 categoryId) private {
        RequestMeta storage meta = metas[id];
        meta.dueAt = uint64(block.timestamp) + uint64(registry.slaHoursOf(categoryId)) * 1 hours;
        meta.escalated = false;
    }
}
