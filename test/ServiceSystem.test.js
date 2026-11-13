const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

const Role = { None: 0, Operator: 1, Supervisor: 2 };
const HOUR = 3600;
const DAY = 24 * HOUR;

describe("Municipal service request system", function () {
  async function deployFixture() {
    const [municipality, citizen, contractor, outsider, nextOwner, supervisor, supervisor2, operator2, oracle] = await ethers.getSigners();
    const Registry = await ethers.getContractFactory("ServiceRegistry");
    const registry = await Registry.deploy(municipality.address);
    await registry.waitForDeployment();
    const Workflow = await ethers.getContractFactory("ServiceRequestWorkflow");
    const workflow = await Workflow.deploy(await registry.getAddress());
    await workflow.waitForDeployment();
    await registry.addCategory("Ndricim publik", 48);
    await registry.addCategory("Ujesjelles", 24);
    await registry.addCategory("Rruge", 72);
    await registry.setContractor(contractor.address, true);
    // Administratori (pronari) vepron edhe si operator; verifikimi kalon te mbikëqyrësi.
    await registry.setOfficial(municipality.address, Role.Operator);
    await registry.setOfficial(supervisor.address, Role.Supervisor);
    await registry.setAiOracle(oracle.address);
    return { registry, workflow, municipality, citizen, contractor, outsider, nextOwner, supervisor, supervisor2, operator2, oracle };
  }

  // Nënshkrimi EIP-712 i vlerësimit të AI-së, njësoj si e bën backend-i (ethers signTypedData).
  const AI_TYPES = { AiAssessment: [
    { name: "requestId", type: "uint256" }, { name: "proofHash", type: "bytes32" }, { name: "verdict", type: "uint8" },
    { name: "confidence", type: "uint8" }, { name: "sameLocation", type: "bool" }, { name: "reportHash", type: "bytes32" },
    { name: "deadline", type: "uint256" }
  ] };
  const Verdict = { None: 0, Resolved: 1, NotResolved: 2, Inconclusive: 3 };

  async function aiDomain(workflow) {
    const { chainId } = await ethers.provider.getNetwork();
    return { name: "ServiceRequestWorkflow", version: "3", chainId, verifyingContract: await workflow.getAddress() };
  }

  async function signedAssessment(workflow, signer, overrides = {}) {
    const a = { id: 1, proofCid: "cid-proof", verdict: Verdict.Resolved, confidence: 91, sameLocation: true,
      reportCid: "cid-ai-report", deadline: (await time.latest()) + 3600, ...overrides };
    const value = { requestId: a.id, proofHash: ethers.keccak256(ethers.toUtf8Bytes(a.proofCid)), verdict: a.verdict,
      confidence: a.confidence, sameLocation: a.sameLocation, reportHash: ethers.keccak256(ethers.toUtf8Bytes(a.reportCid)), deadline: a.deadline };
    const signature = await signer.signTypedData(await aiDomain(workflow), AI_TYPES, value);
    return { ...a, value, signature, args: [a.id, a.verdict, a.confidence, a.sameLocation, a.reportCid, a.deadline, signature] };
  }

  async function aiRejectedFixture() {
    const f = await loadFixture(workSubmittedFixture);
    const s = await signedAssessment(f.workflow, f.oracle, { verdict: Verdict.NotResolved, confidence: 88, sameLocation: false });
    await f.workflow.submitAiAssessment(...s.args);
    return f;
  }

  async function verifiedFixture() {
    const f = await loadFixture(workSubmittedFixture);
    await f.workflow.connect(f.supervisor).verifyResolution(1);
    return f;
  }

  async function disputedFixture() {
    const f = await loadFixture(verifiedFixture);
    await f.workflow.connect(f.citizen).disputeResolution(1, "cid-evidence");
    return f;
  }

  async function submittedFixture() {
    const f = await loadFixture(deployFixture);
    await f.workflow.connect(f.citizen).submitRequest("cid-description", "42.66,21.16");
    return f;
  }

  async function categorizedFixture() {
    const f = await loadFixture(submittedFixture);
    await f.workflow.categorizeRequest(1, 1);
    return f;
  }

  async function assignedFixture() {
    const f = await loadFixture(categorizedFixture);
    await f.workflow.assignContractor(1, f.contractor.address);
    return f;
  }

  async function workSubmittedFixture() {
    const f = await loadFixture(assignedFixture);
    await f.workflow.connect(f.contractor).startWork(1);
    await f.workflow.connect(f.contractor).submitWorkProof(1, "cid-proof");
    return f;
  }

  describe("ServiceRegistry", function () {
    it("sets municipality as owner", async function () {
      const { registry, municipality } = await loadFixture(deployFixture);
      expect(await registry.owner()).to.equal(municipality.address);
    });

    it("creates the three required categories", async function () {
      const { registry } = await loadFixture(deployFixture);
      expect(await registry.categoryCount()).to.equal(3);
      expect((await registry.getCategory(1)).name).to.equal("Ndricim publik");
    });

    it("rejects an empty category", async function () {
      const { registry } = await loadFixture(deployFixture);
      await expect(registry.addCategory("", 12)).to.be.revertedWithCustomError(registry, "InvalidInput");
    });

    it("blocks non-owner category creation", async function () {
      const { registry, outsider } = await loadFixture(deployFixture);
      await expect(registry.connect(outsider).addCategory("Mbeturina", 12)).to.be.revertedWithCustomError(registry, "Unauthorized");
    });

    it("updates and deactivates a category", async function () {
      const { registry } = await loadFixture(deployFixture);
      await registry.updateCategory(1, "Ndricim", 36, false);
      expect(await registry.isCategoryActive(1)).to.equal(false);
      expect((await registry.getCategory(1)).slaHours).to.equal(36);
    });

    it("rejects a non-existing category", async function () {
      const { registry } = await loadFixture(deployFixture);
      await expect(registry.getCategory(99)).to.be.revertedWithCustomError(registry, "InvalidCategory");
    });

    it("authorizes and revokes a contractor", async function () {
      const { registry, contractor } = await loadFixture(deployFixture);
      expect(await registry.isAuthorizedContractor(contractor.address)).to.equal(true);
      await registry.setContractor(contractor.address, false);
      expect(await registry.isAuthorizedContractor(contractor.address)).to.equal(false);
    });

    it("rejects zero contractor address", async function () {
      const { registry } = await loadFixture(deployFixture);
      await expect(registry.setContractor(ethers.ZeroAddress, true)).to.be.revertedWithCustomError(registry, "InvalidAddress");
    });

    it("uses two-step ownership transfer", async function () {
      const { registry, nextOwner } = await loadFixture(deployFixture);
      await registry.transferOwnership(nextOwner.address);
      await registry.connect(nextOwner).acceptOwnership();
      expect(await registry.owner()).to.equal(nextOwner.address);
    });

    it("blocks ownership acceptance by a third party", async function () {
      const { registry, nextOwner, outsider } = await loadFixture(deployFixture);
      await registry.transferOwnership(nextOwner.address);
      await expect(registry.connect(outsider).acceptOwnership()).to.be.revertedWithCustomError(registry, "Unauthorized");
    });
  });

  describe("ServiceRequestWorkflow", function () {
    it("submits a request and emits an event", async function () {
      const { workflow, citizen } = await loadFixture(deployFixture);
      await expect(workflow.connect(citizen).submitRequest("cid-a", "location-a"))
        .to.emit(workflow, "RequestSubmitted").withArgs(1, citizen.address, "cid-a");
    });

    it("rejects missing off-chain metadata", async function () {
      const { workflow, citizen } = await loadFixture(deployFixture);
      await expect(workflow.connect(citizen).submitRequest("", "location"))
        .to.be.revertedWithCustomError(workflow, "InvalidInput");
    });

    it("allows only municipality to categorize", async function () {
      const { workflow, outsider } = await loadFixture(submittedFixture);
      await expect(workflow.connect(outsider).categorizeRequest(1, 1))
        .to.be.revertedWithCustomError(workflow, "Unauthorized");
    });

    it("requires an active category", async function () {
      const { registry, workflow } = await loadFixture(submittedFixture);
      await registry.updateCategory(1, "Ndricim", 48, false);
      await expect(workflow.categorizeRequest(1, 1)).to.be.revertedWithCustomError(workflow, "InvalidInput");
    });

    it("categorizes a submitted request", async function () {
      const { workflow } = await loadFixture(submittedFixture);
      await workflow.categorizeRequest(1, 2);
      const item = await workflow.getRequest(1);
      expect(item.categoryId).to.equal(2);
      expect(item.status).to.equal(1);
    });

    it("only municipality assigns contractor", async function () {
      const { workflow, outsider, contractor } = await loadFixture(categorizedFixture);
      await expect(workflow.connect(outsider).assignContractor(1, contractor.address))
        .to.be.revertedWithCustomError(workflow, "Unauthorized");
    });

    it("requires an authorized contractor", async function () {
      const { workflow, outsider } = await loadFixture(categorizedFixture);
      await expect(workflow.assignContractor(1, outsider.address))
        .to.be.revertedWithCustomError(workflow, "Unauthorized");
    });

    it("assigns an authorized contractor", async function () {
      const { workflow, contractor } = await loadFixture(categorizedFixture);
      await expect(workflow.assignContractor(1, contractor.address))
        .to.emit(workflow, "ContractorAssigned").withArgs(1, contractor.address);
      expect((await workflow.getRequest(1)).status).to.equal(2);
    });

    it("only assigned contractor starts work", async function () {
      const { workflow, outsider } = await loadFixture(assignedFixture);
      await expect(workflow.connect(outsider).startWork(1)).to.be.revertedWithCustomError(workflow, "Unauthorized");
    });

    it("starts work exactly once", async function () {
      const { workflow, contractor } = await loadFixture(assignedFixture);
      await workflow.connect(contractor).startWork(1);
      expect((await workflow.getRequest(1)).status).to.equal(3);
      await expect(workflow.connect(contractor).startWork(1)).to.be.revertedWithCustomError(workflow, "InvalidStatus");
    });

    it("requires proof before work submission", async function () {
      const { workflow, contractor } = await loadFixture(assignedFixture);
      await workflow.connect(contractor).startWork(1);
      await expect(workflow.connect(contractor).submitWorkProof(1, ""))
        .to.be.revertedWithCustomError(workflow, "InvalidInput");
    });

    it("stores immutable work proof reference", async function () {
      const { workflow } = await loadFixture(workSubmittedFixture);
      const item = await workflow.getRequest(1);
      expect(item.workProofCid).to.equal("cid-proof");
      expect(item.status).to.equal(4);
    });

    it("cannot close without work proof state", async function () {
      const { workflow, supervisor } = await loadFixture(assignedFixture);
      await expect(workflow.connect(supervisor).verifyResolution(1)).to.be.revertedWithCustomError(workflow, "InvalidStatus");
    });

    it("municipality supervisor verifies a completed request", async function () {
      const { workflow, supervisor } = await loadFixture(workSubmittedFixture);
      await expect(workflow.connect(supervisor).verifyResolution(1))
        .to.emit(workflow, "RequestVerified").withArgs(1, supervisor.address);
      expect((await workflow.getRequest(1)).status).to.equal(5);
      expect((await workflow.getRequestMeta(1)).verifiedBy).to.equal(supervisor.address);
    });

    it("citizen cannot alter a closed request", async function () {
      const { workflow, citizen } = await loadFixture(verifiedFixture);
      await expect(workflow.connect(citizen).cancelRequest(1)).to.be.revertedWithCustomError(workflow, "InvalidStatus");
    });

    it("citizen can cancel only their submitted request", async function () {
      const { workflow, citizen } = await loadFixture(submittedFixture);
      await expect(workflow.connect(citizen).cancelRequest(1)).to.emit(workflow, "RequestCancelled");
      expect((await workflow.getRequest(1)).status).to.equal(7);
    });

    it("outsider cannot cancel another citizen request", async function () {
      const { workflow, outsider } = await loadFixture(submittedFixture);
      await expect(workflow.connect(outsider).cancelRequest(1)).to.be.revertedWithCustomError(workflow, "Unauthorized");
    });

    it("municipality can reject a submitted request with reason", async function () {
      const { workflow } = await loadFixture(submittedFixture);
      await workflow.rejectRequest(1, "cid-reason");
      const item = await workflow.getRequest(1);
      expect(item.status).to.equal(6);
      expect(item.workProofCid).to.equal("cid-reason");
    });

    it("citizen rates a verified resolution once", async function () {
      const { workflow, citizen } = await loadFixture(verifiedFixture);
      await workflow.connect(citizen).rateResolution(1, 5);
      expect((await workflow.getRequest(1)).rating).to.equal(5);
      await expect(workflow.connect(citizen).rateResolution(1, 4)).to.be.revertedWithCustomError(workflow, "InvalidInput");
    });

    it("rejects invalid ratings", async function () {
      const { workflow, citizen } = await loadFixture(verifiedFixture);
      await expect(workflow.connect(citizen).rateResolution(1, 0)).to.be.revertedWithCustomError(workflow, "InvalidInput");
      await expect(workflow.connect(citizen).rateResolution(1, 6)).to.be.revertedWithCustomError(workflow, "InvalidInput");
    });

    it("returns paginated requests", async function () {
      const { workflow, citizen } = await loadFixture(submittedFixture);
      await workflow.connect(citizen).submitRequest("cid-b", "location-b");
      await workflow.connect(citizen).submitRequest("cid-c", "location-c");
      const page = await workflow.getRequests(1, 2);
      expect(page.length).to.equal(2);
      expect(page[0].id).to.equal(2);
      expect(page[1].id).to.equal(3);
    });

    it("rejects a non-existing request", async function () {
      const { workflow } = await loadFixture(deployFixture);
      await expect(workflow.getRequest(1)).to.be.revertedWithCustomError(workflow, "InvalidRequest");
    });
  });

  describe("V2 - four-eyes officials", function () {
    it("only the administrator appoints officials", async function () {
      const { registry, outsider } = await loadFixture(deployFixture);
      await expect(registry.connect(outsider).setOfficial(outsider.address, Role.Operator))
        .to.be.revertedWithCustomError(registry, "Unauthorized");
    });

    it("appoints an official and emits an event", async function () {
      const { registry, operator2 } = await loadFixture(deployFixture);
      await expect(registry.setOfficial(operator2.address, Role.Operator))
        .to.emit(registry, "OfficialRoleChanged").withArgs(operator2.address, Role.Operator);
      expect(await registry.roleOf(operator2.address)).to.equal(Role.Operator);
    });

    it("a contractor cannot become an official", async function () {
      const { registry, contractor } = await loadFixture(deployFixture);
      await expect(registry.setOfficial(contractor.address, Role.Supervisor))
        .to.be.revertedWithCustomError(registry, "ConflictOfInterest");
    });

    it("an official cannot be authorized as contractor", async function () {
      const { registry, supervisor } = await loadFixture(deployFixture);
      await expect(registry.setContractor(supervisor.address, true))
        .to.be.revertedWithCustomError(registry, "ConflictOfInterest");
    });

    it("supervisor cannot categorize or assign", async function () {
      const { workflow, supervisor, contractor } = await loadFixture(submittedFixture);
      await expect(workflow.connect(supervisor).categorizeRequest(1, 1))
        .to.be.revertedWithCustomError(workflow, "Unauthorized");
      await workflow.categorizeRequest(1, 1);
      await expect(workflow.connect(supervisor).assignContractor(1, contractor.address))
        .to.be.revertedWithCustomError(workflow, "Unauthorized");
    });

    it("operator cannot verify work", async function () {
      const { workflow } = await loadFixture(workSubmittedFixture);
      await expect(workflow.verifyResolution(1)).to.be.revertedWithCustomError(workflow, "Unauthorized");
    });

    it("records which operator assigned the contractor", async function () {
      const { workflow, municipality } = await loadFixture(assignedFixture);
      expect((await workflow.getRequestMeta(1)).assignedBy).to.equal(municipality.address);
    });

    it("the assigning official cannot verify the same work even after becoming supervisor", async function () {
      const { registry, workflow, municipality } = await loadFixture(workSubmittedFixture);
      await registry.setOfficial(municipality.address, Role.Supervisor);
      await expect(workflow.verifyResolution(1)).to.be.revertedWithCustomError(workflow, "SelfReview");
    });

    it("removing a role revokes access immediately", async function () {
      const { registry, workflow, supervisor } = await loadFixture(workSubmittedFixture);
      await registry.setOfficial(supervisor.address, Role.None);
      await expect(workflow.connect(supervisor).verifyResolution(1))
        .to.be.revertedWithCustomError(workflow, "Unauthorized");
    });
  });

  describe("V2 - public SLA escalation", function () {
    it("sets a 48h triage deadline on submission", async function () {
      const { workflow } = await loadFixture(submittedFixture);
      const item = await workflow.getRequest(1);
      expect((await workflow.getRequestMeta(1)).dueAt).to.equal(item.createdAt + BigInt(48 * HOUR));
    });

    it("cannot escalate before the deadline", async function () {
      const { workflow, outsider } = await loadFixture(submittedFixture);
      await expect(workflow.connect(outsider).escalate(1)).to.be.revertedWithCustomError(workflow, "NotOverdue");
    });

    it("anyone can escalate an overdue request once", async function () {
      const { workflow, outsider } = await loadFixture(submittedFixture);
      await time.increase(49 * HOUR);
      await expect(workflow.connect(outsider).escalate(1)).to.emit(workflow, "RequestEscalated");
      expect((await workflow.getRequestMeta(1)).escalated).to.equal(true);
      await expect(workflow.connect(outsider).escalate(1)).to.be.revertedWithCustomError(workflow, "AlreadyEscalated");
    });

    it("categorization replaces the triage deadline with the category SLA", async function () {
      const { workflow } = await loadFixture(submittedFixture);
      await workflow.categorizeRequest(1, 2); // Ujesjelles, 24h
      const now = await time.latest();
      expect((await workflow.getRequestMeta(1)).dueAt).to.equal(BigInt(now + 24 * HOUR));
    });

    it("a closed request cannot be escalated", async function () {
      const { workflow, outsider } = await loadFixture(verifiedFixture);
      await time.increase(10 * DAY);
      await expect(workflow.connect(outsider).escalate(1)).to.be.revertedWithCustomError(workflow, "ClosedRequest");
    });
  });

  describe("V2 - citizen dispute", function () {
    it("citizen disputes a verified resolution with evidence", async function () {
      const { workflow, citizen } = await loadFixture(verifiedFixture);
      await expect(workflow.connect(citizen).disputeResolution(1, "cid-evidence"))
        .to.emit(workflow, "ResolutionDisputed").withArgs(1, citizen.address, "cid-evidence");
      expect((await workflow.getRequest(1)).status).to.equal(8);
    });

    it("only the request citizen can dispute", async function () {
      const { workflow, outsider } = await loadFixture(verifiedFixture);
      await expect(workflow.connect(outsider).disputeResolution(1, "cid-evidence"))
        .to.be.revertedWithCustomError(workflow, "Unauthorized");
    });

    it("dispute requires evidence", async function () {
      const { workflow, citizen } = await loadFixture(verifiedFixture);
      await expect(workflow.connect(citizen).disputeResolution(1, ""))
        .to.be.revertedWithCustomError(workflow, "InvalidInput");
    });

    it("dispute window closes after 7 days", async function () {
      const { workflow, citizen } = await loadFixture(verifiedFixture);
      await time.increase(7 * DAY + 1);
      await expect(workflow.connect(citizen).disputeResolution(1, "cid-evidence"))
        .to.be.revertedWithCustomError(workflow, "DisputeWindowClosed");
    });

    it("a rated resolution is final", async function () {
      const { workflow, citizen } = await loadFixture(verifiedFixture);
      await workflow.connect(citizen).rateResolution(1, 4);
      await expect(workflow.connect(citizen).disputeResolution(1, "cid-evidence"))
        .to.be.revertedWithCustomError(workflow, "InvalidStatus");
    });

    it("operator reopens a disputed request and old proof is cleared", async function () {
      const { workflow, municipality } = await loadFixture(disputedFixture);
      await expect(workflow.reopenRequest(1)).to.emit(workflow, "RequestReopened").withArgs(1, municipality.address);
      const item = await workflow.getRequest(1);
      expect(item.status).to.equal(2);
      expect(item.workProofCid).to.equal("");
    });

    it("supervisor cannot reopen a dispute", async function () {
      const { workflow, supervisor } = await loadFixture(disputedFixture);
      await expect(workflow.connect(supervisor).reopenRequest(1)).to.be.revertedWithCustomError(workflow, "Unauthorized");
    });

    it("the verifying supervisor cannot dismiss the dispute", async function () {
      const { workflow, supervisor } = await loadFixture(disputedFixture);
      await expect(workflow.connect(supervisor).dismissDispute(1, "cid-reason"))
        .to.be.revertedWithCustomError(workflow, "SelfReview");
    });

    it("a second supervisor dismisses the dispute with a reason", async function () {
      const { registry, workflow, supervisor2 } = await loadFixture(disputedFixture);
      await registry.setOfficial(supervisor2.address, Role.Supervisor);
      await expect(workflow.connect(supervisor2).dismissDispute(1, "")).to.be.revertedWithCustomError(workflow, "InvalidInput");
      await expect(workflow.connect(supervisor2).dismissDispute(1, "cid-reason")).to.emit(workflow, "DisputeDismissed");
      expect((await workflow.getRequest(1)).status).to.equal(5);
    });

    it("allows at most two disputes", async function () {
      const { registry, workflow, citizen, supervisor2 } = await loadFixture(disputedFixture);
      await registry.setOfficial(supervisor2.address, Role.Supervisor);
      await workflow.connect(supervisor2).dismissDispute(1, "cid-reason-1");
      await workflow.connect(citizen).disputeResolution(1, "cid-evidence-2");
      await workflow.connect(supervisor2).dismissDispute(1, "cid-reason-2");
      await expect(workflow.connect(citizen).disputeResolution(1, "cid-evidence-3"))
        .to.be.revertedWithCustomError(workflow, "InvalidInput");
    });

    it("full flow: dispute, reopen, new proof, verification by supervisor, rating", async function () {
      const { workflow, citizen, contractor, supervisor } = await loadFixture(disputedFixture);
      await workflow.reopenRequest(1);
      await workflow.connect(contractor).startWork(1);
      await workflow.connect(contractor).submitWorkProof(1, "cid-proof-2");
      await workflow.connect(supervisor).verifyResolution(1);
      await workflow.connect(citizen).rateResolution(1, 5);
      const item = await workflow.getRequest(1);
      expect(item.status).to.equal(5);
      expect(item.workProofCid).to.equal("cid-proof-2");
      expect(item.rating).to.equal(5);
    });
  });

  describe("V3 - AI oracle (third eye)", function () {
    it("only the administrator sets the AI oracle", async function () {
      const { registry, outsider } = await loadFixture(deployFixture);
      await expect(registry.connect(outsider).setAiOracle(outsider.address)).to.be.revertedWithCustomError(registry, "Unauthorized");
    });

    it("the oracle cannot be an official or contractor", async function () {
      const { registry, supervisor, contractor, oracle } = await loadFixture(deployFixture);
      await expect(registry.setAiOracle(supervisor.address)).to.be.revertedWithCustomError(registry, "ConflictOfInterest");
      await expect(registry.setAiOracle(contractor.address)).to.be.revertedWithCustomError(registry, "ConflictOfInterest");
      await expect(registry.setOfficial(oracle.address, Role.Supervisor)).to.be.revertedWithCustomError(registry, "ConflictOfInterest");
      await expect(registry.setContractor(oracle.address, true)).to.be.revertedWithCustomError(registry, "ConflictOfInterest");
    });

    it("contract digest matches the standard EIP-712 hash used by the backend", async function () {
      const { workflow, oracle } = await loadFixture(workSubmittedFixture);
      const s = await signedAssessment(workflow, oracle);
      const expected = ethers.TypedDataEncoder.hash(await aiDomain(workflow), AI_TYPES, s.value);
      expect(await workflow.aiAssessmentDigest(1, s.value.proofHash, s.verdict, s.confidence, s.sameLocation, s.value.reportHash, s.deadline))
        .to.equal(expected);
    });

    it("records an assessment signed by the oracle, relayed by anyone", async function () {
      const { workflow, oracle, outsider } = await loadFixture(workSubmittedFixture);
      const s = await signedAssessment(workflow, oracle);
      await expect(workflow.connect(outsider).submitAiAssessment(...s.args))
        .to.emit(workflow, "AiAssessmentRecorded").withArgs(1, Verdict.Resolved, 91, true, "cid-ai-report");
      const stored = await workflow.getAiAssessment(1);
      expect(stored.verdict).to.equal(Verdict.Resolved);
      expect(stored.confidence).to.equal(91);
      expect(await workflow.currentAiVerdict(1)).to.equal(Verdict.Resolved);
    });

    it("rejects an assessment signed by someone else", async function () {
      const { workflow, outsider } = await loadFixture(workSubmittedFixture);
      const s = await signedAssessment(workflow, outsider);
      await expect(workflow.submitAiAssessment(...s.args)).to.be.revertedWithCustomError(workflow, "InvalidSignature");
    });

    it("rejects tampered data under a valid signature", async function () {
      const { workflow, oracle } = await loadFixture(workSubmittedFixture);
      const s = await signedAssessment(workflow, oracle, { verdict: Verdict.NotResolved, confidence: 30 });
      const tampered = [...s.args]; tampered[1] = Verdict.Resolved; tampered[2] = 95;
      await expect(workflow.submitAiAssessment(...tampered)).to.be.revertedWithCustomError(workflow, "InvalidSignature");
    });

    it("rejects an expired signature", async function () {
      const { workflow, oracle } = await loadFixture(workSubmittedFixture);
      const s = await signedAssessment(workflow, oracle, { deadline: (await time.latest()) - 1 });
      await expect(workflow.submitAiAssessment(...s.args)).to.be.revertedWithCustomError(workflow, "SignatureExpired");
    });

    it("rejects a signature made for another contract", async function () {
      const { registry, workflow, oracle } = await loadFixture(workSubmittedFixture);
      const Workflow = await ethers.getContractFactory("ServiceRequestWorkflow");
      const other = await Workflow.deploy(await registry.getAddress());
      const s = await signedAssessment(other, oracle);
      await expect(workflow.submitAiAssessment(...s.args)).to.be.revertedWithCustomError(workflow, "InvalidSignature");
    });

    it("assessment is only accepted while work is awaiting verification", async function () {
      const { workflow, oracle } = await loadFixture(assignedFixture);
      const s = await signedAssessment(workflow, oracle, { proofCid: "" });
      await expect(workflow.submitAiAssessment(...s.args)).to.be.revertedWithCustomError(workflow, "InvalidStatus");
    });

    it("a negative AI verdict blocks plain verification", async function () {
      const { workflow, supervisor } = await loadFixture(aiRejectedFixture);
      await expect(workflow.connect(supervisor).verifyResolution(1)).to.be.revertedWithCustomError(workflow, "OverrideReasonRequired");
    });

    it("supervisor overrides the AI only with a public reason", async function () {
      const { workflow, supervisor } = await loadFixture(aiRejectedFixture);
      await expect(workflow.connect(supervisor).verifyAgainstAi(1, "")).to.be.revertedWithCustomError(workflow, "InvalidInput");
      await expect(workflow.connect(supervisor).verifyAgainstAi(1, "cid-override-reason"))
        .to.emit(workflow, "AiVerdictOverridden").withArgs(1, supervisor.address, "cid-override-reason");
      expect((await workflow.getRequest(1)).status).to.equal(5);
    });

    it("override is not allowed when the AI did not reject the work", async function () {
      const { workflow, supervisor } = await loadFixture(workSubmittedFixture);
      await expect(workflow.connect(supervisor).verifyAgainstAi(1, "cid-reason")).to.be.revertedWithCustomError(workflow, "InvalidStatus");
    });

    it("override still respects the four-eyes rule", async function () {
      const { registry, workflow, municipality } = await loadFixture(aiRejectedFixture);
      await registry.setOfficial(municipality.address, Role.Supervisor);
      await expect(workflow.verifyAgainstAi(1, "cid-reason")).to.be.revertedWithCustomError(workflow, "SelfReview");
    });

    it("an old AI verdict does not apply to new proof after reopening", async function () {
      const { workflow, oracle, citizen, contractor, supervisor } = await loadFixture(workSubmittedFixture);
      await workflow.submitAiAssessment(...(await signedAssessment(workflow, oracle)).args);
      await workflow.connect(supervisor).verifyResolution(1);
      await workflow.connect(citizen).disputeResolution(1, "cid-evidence");
      await workflow.reopenRequest(1);
      await workflow.connect(contractor).startWork(1);
      await workflow.connect(contractor).submitWorkProof(1, "cid-proof-2");
      expect(await workflow.currentAiVerdict(1)).to.equal(Verdict.None);
      const stale = await signedAssessment(workflow, oracle, { verdict: Verdict.NotResolved });
      await expect(workflow.submitAiAssessment(...stale.args)).to.be.revertedWithCustomError(workflow, "InvalidSignature");
    });

    it("with the oracle disabled, assessments are rejected and v2 flow works", async function () {
      const { registry, workflow, oracle, supervisor } = await loadFixture(workSubmittedFixture);
      await registry.setAiOracle(ethers.ZeroAddress);
      const s = await signedAssessment(workflow, oracle);
      await expect(workflow.submitAiAssessment(...s.args)).to.be.revertedWithCustomError(workflow, "InvalidSignature");
      await expect(workflow.connect(supervisor).verifyResolution(1)).to.emit(workflow, "RequestVerified");
    });
  });
});
