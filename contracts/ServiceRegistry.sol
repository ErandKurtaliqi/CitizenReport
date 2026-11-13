// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract ServiceRegistry {
    struct Category {
        string name;
        uint32 slaHours;
        bool active;
    }

    // Parimi "katër sy": operatori kategorizon dhe cakton, mbikëqyrësi verifikon.
    enum Role { None, Operator, Supervisor }

    address public owner;
    address public pendingOwner;
    uint256 public categoryCount;
    mapping(uint256 => Category) private categories;
    mapping(address => bool) private contractors;
    mapping(address => Role) private officials;
    // Versioni 3: adresa që nënshkruan vlerësimet e AI-së. address(0) = AI e çaktivizuar.
    address public aiOracle;

    event OwnershipTransferStarted(address indexed currentOwner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event CategoryAdded(uint256 indexed categoryId, string name, uint32 slaHours);
    event CategoryUpdated(uint256 indexed categoryId, string name, uint32 slaHours, bool active);
    event ContractorAuthorizationChanged(address indexed contractor, bool authorized);
    event OfficialRoleChanged(address indexed account, Role role);
    event AiOracleChanged(address indexed previousOracle, address indexed newOracle);

    error Unauthorized();
    error InvalidAddress();
    error InvalidCategory();
    error InvalidInput();
    error ConflictOfInterest();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(address municipality) {
        if (municipality == address(0)) revert InvalidAddress();
        owner = municipality;
        emit OwnershipTransferred(address(0), municipality);
    }

    function addCategory(string calldata name, uint32 slaHours) external onlyOwner returns (uint256 id) {
        if (bytes(name).length == 0 || slaHours == 0) revert InvalidInput();
        id = ++categoryCount;
        categories[id] = Category(name, slaHours, true);
        emit CategoryAdded(id, name, slaHours);
    }

    function updateCategory(uint256 id, string calldata name, uint32 slaHours, bool active) external onlyOwner {
        if (id == 0 || id > categoryCount) revert InvalidCategory();
        if (bytes(name).length == 0 || slaHours == 0) revert InvalidInput();
        categories[id] = Category(name, slaHours, active);
        emit CategoryUpdated(id, name, slaHours, active);
    }

    function setContractor(address contractor, bool authorized) external onlyOwner {
        if (contractor == address(0)) revert InvalidAddress();
        if (authorized && (officials[contractor] != Role.None || contractor == aiOracle)) revert ConflictOfInterest();
        contractors[contractor] = authorized;
        emit ContractorAuthorizationChanged(contractor, authorized);
    }

    /// Emëron ose heq një zyrtar komunal. Një kontraktues nuk mund të jetë zyrtar.
    function setOfficial(address account, Role role) external onlyOwner {
        if (account == address(0)) revert InvalidAddress();
        if (role != Role.None && (contractors[account] || account == aiOracle)) revert ConflictOfInterest();
        officials[account] = role;
        emit OfficialRoleChanged(account, role);
    }

    /// Cakton oracle-in e AI-së. Oracle-i nuk mund të jetë zyrtar ose kontraktues; address(0) e çaktivizon.
    function setAiOracle(address oracle) external onlyOwner {
        if (oracle != address(0) && (officials[oracle] != Role.None || contractors[oracle])) revert ConflictOfInterest();
        emit AiOracleChanged(aiOracle, oracle);
        aiOracle = oracle;
    }

    function roleOf(address account) external view returns (Role) {
        return officials[account];
    }

    function slaHoursOf(uint256 id) external view returns (uint32) {
        if (id == 0 || id > categoryCount) revert InvalidCategory();
        return categories[id].slaHours;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert InvalidAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert Unauthorized();
        address previous = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(previous, msg.sender);
    }

    function getCategory(uint256 id) external view returns (Category memory) {
        if (id == 0 || id > categoryCount) revert InvalidCategory();
        return categories[id];
    }

    function isCategoryActive(uint256 id) external view returns (bool) {
        return id > 0 && id <= categoryCount && categories[id].active;
    }

    function isAuthorizedContractor(address account) external view returns (bool) {
        return contractors[account];
    }
}
