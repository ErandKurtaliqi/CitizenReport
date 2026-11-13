import { ethers } from "ethers";

const workflowAbi = [
  "function requestCount() view returns (uint256)",
  "function getRequests(uint256 offset,uint256 limit) view returns ((uint256 id,address citizen,uint256 categoryId,address contractor,uint8 status,string descriptionCid,string locationHash,string workProofCid,uint8 rating,uint64 createdAt,uint64 assignedAt,uint64 closedAt)[])",
  "function getRequestMeta(uint256 id) view returns ((address assignedBy,address verifiedBy,uint64 dueAt,bool escalated,uint8 disputeCount,string disputeCid))",
  "function getRequest(uint256 id) view returns ((uint256 id,address citizen,uint256 categoryId,address contractor,uint8 status,string descriptionCid,string locationHash,string workProofCid,uint8 rating,uint64 createdAt,uint64 assignedAt,uint64 closedAt))",
  "function getAiAssessment(uint256 id) view returns ((uint8 verdict,uint8 confidence,bool sameLocation,string reportCid,bytes32 proofHash,uint64 assessedAt))",
  "function currentAiVerdict(uint256 id) view returns (uint8)",
  "function submitAiAssessment(uint256 id,uint8 verdict,uint8 confidence,bool sameLocation,string reportCid,uint256 deadline,bytes signature)"
];

const registryAbi = [
  "function categoryCount() view returns (uint256)",
  "function getCategory(uint256 id) view returns ((string name,uint32 slaHours,bool active))",
  "function aiOracle() view returns (address)"
];

export const AI_VERDICTS = ["None", "Resolved", "NotResolved", "Inconclusive"];

export const STATUS = ["Submitted", "Categorized", "Assigned", "InProgress", "WorkSubmitted", "Verified", "Rejected", "Cancelled", "Disputed"];
// Statuset ku kërkesa është ende e hapur (Disputed pret vendimin e komunës).
export const OPEN_STATUSES = [0, 1, 2, 3, 4, 8];

export function getContracts() {
  const rpcUrl = process.env.RPC_URL || "http://127.0.0.1:8545";
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const workflowAddress = process.env.WORKFLOW_ADDRESS;
  const registryAddress = process.env.REGISTRY_ADDRESS;
  if (!ethers.isAddress(workflowAddress) || !ethers.isAddress(registryAddress)) {
    throw new Error("WORKFLOW_ADDRESS dhe REGISTRY_ADDRESS duhet te konfigurohen ne backend/.env");
  }
  return {
    provider,
    workflow: new ethers.Contract(workflowAddress, workflowAbi, provider),
    registry: new ethers.Contract(registryAddress, registryAbi, provider)
  };
}

export function serializeRequest(item) {
  return {
    id: Number(item.id), citizen: item.citizen, categoryId: Number(item.categoryId), contractor: item.contractor,
    status: Number(item.status), statusName: STATUS[Number(item.status)], descriptionCid: item.descriptionCid,
    locationHash: item.locationHash, workProofCid: item.workProofCid, rating: Number(item.rating),
    createdAt: Number(item.createdAt), assignedAt: Number(item.assignedAt), closedAt: Number(item.closedAt)
  };
}

export async function readAll() {
  const { workflow } = getContracts();
  const count = Number(await workflow.requestCount());
  if (!count) return [];
  const items = (await workflow.getRequests(0, count)).map(serializeRequest);
  const [metas, verdicts, assessments] = await Promise.all([
    Promise.all(items.map((item) => workflow.getRequestMeta(item.id))),
    Promise.all(items.map((item) => workflow.currentAiVerdict(item.id))),
    Promise.all(items.map((item) => workflow.getAiAssessment(item.id)))
  ]);
  return items.map((item, index) => ({ ...item, ...serializeMeta(metas[index]), ai: serializeAi(assessments[index], verdicts[index]) }));
}

/// currentVerdict: verdikti që vlen për dëshminë aktuale (pas rihapjes vlerësimi i vjetër nuk vlen).
export function serializeAi(a, currentVerdict) {
  const verdict = Number(a.verdict);
  if (!verdict) return null;
  return {
    verdict: AI_VERDICTS[verdict], confidence: Number(a.confidence), sameLocation: a.sameLocation,
    reportCid: a.reportCid, assessedAt: Number(a.assessedAt), current: Number(currentVerdict) === verdict
  };
}

export function serializeMeta(meta) {
  return {
    assignedBy: meta.assignedBy, verifiedBy: meta.verifiedBy, dueAt: Number(meta.dueAt),
    escalated: meta.escalated, disputeCount: Number(meta.disputeCount), disputeCid: meta.disputeCid
  };
}

// Koha e blockchain-it (jo e serverit): afatet SLA krahasohen me block.timestamp, si në kontratë.
export async function chainTime() {
  const { provider } = getContracts();
  const block = await provider.getBlock("latest");
  return Number(block.timestamp);
}

export async function readCategories() {
  const { registry } = getContracts();
  const count = Number(await registry.categoryCount());
  return Promise.all(Array.from({ length: count }, async (_, index) => {
    const category = await registry.getCategory(index + 1);
    return { id: index + 1, name: category.name, slaHours: Number(category.slaHours), active: category.active };
  }));
}
