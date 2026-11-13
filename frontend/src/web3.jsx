import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";

const registryAbi = [
  "function owner() view returns (address)",
  "function categoryCount() view returns (uint256)",
  "function getCategory(uint256) view returns ((string name,uint32 slaHours,bool active))",
  "function addCategory(string,uint32)", "function setContractor(address,bool)",
  "function isAuthorizedContractor(address) view returns (bool)",
  "function roleOf(address) view returns (uint8)", "function setOfficial(address,uint8)"
];
const workflowAbi = [
  "function requestCount() view returns (uint256)",
  "function getRequests(uint256,uint256) view returns ((uint256 id,address citizen,uint256 categoryId,address contractor,uint8 status,string descriptionCid,string locationHash,string workProofCid,uint8 rating,uint64 createdAt,uint64 assignedAt,uint64 closedAt)[])",
  "function submitRequest(string,string) returns (uint256)", "function categorizeRequest(uint256,uint256)",
  "function assignContractor(uint256,address)", "function startWork(uint256)",
  "function submitWorkProof(uint256,string)", "function verifyResolution(uint256)",
  "function rejectRequest(uint256,string)", "function cancelRequest(uint256)", "function rateResolution(uint256,uint8)",
  "function getRequestMeta(uint256) view returns ((address assignedBy,address verifiedBy,uint64 dueAt,bool escalated,uint8 disputeCount,string disputeCid))",
  "function escalate(uint256)", "function disputeResolution(uint256,string)",
  "function reopenRequest(uint256)", "function dismissDispute(uint256,string)",
  "function getAiAssessment(uint256) view returns ((uint8 verdict,uint8 confidence,bool sameLocation,string reportCid,bytes32 proofHash,uint64 assessedAt))",
  "function currentAiVerdict(uint256) view returns (uint8)", "function verifyAgainstAi(uint256,string)"
];
export const AI_VERDICTS = ["None", "Resolved", "NotResolved", "Inconclusive"];

function normalizeAi(a, current) {
  const verdict = Number(a.verdict);
  if (!verdict) return null;
  return { verdict: AI_VERDICTS[verdict], confidence: Number(a.confidence), sameLocation: a.sameLocation,
    reportCid: a.reportCid, assessedAt: Number(a.assessedAt), current: Number(current) === verdict };
}
const Web3Context = createContext(null);
export const STATUSES = ["E paraqitur", "E kategorizuar", "E caktuar", "Në punë", "Punë e dorëzuar", "E verifikuar", "E refuzuar", "E anuluar", "E kontestuar"];
export const ROLES = { NONE: 0, OPERATOR: 1, SUPERVISOR: 2 };

function normalizeMeta(m) {
  return { assignedBy: m.assignedBy, verifiedBy: m.verifiedBy, dueAt: Number(m.dueAt), escalated: m.escalated,
    disputeCount: Number(m.disputeCount), disputeCid: m.disputeCid };
}

function normalize(r) {
  return { id: Number(r.id), citizen: r.citizen, categoryId: Number(r.categoryId), contractor: r.contractor,
    status: Number(r.status), descriptionCid: r.descriptionCid, locationHash: r.locationHash,
    workProofCid: r.workProofCid, rating: Number(r.rating), createdAt: Number(r.createdAt),
    assignedAt: Number(r.assignedAt), closedAt: Number(r.closedAt) };
}

export function Web3Provider({ children }) {
  const [account, setAccount] = useState("");
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [requests, setRequests] = useState([]);
  const [categories, setCategories] = useState([]);
  const [municipality, setMunicipality] = useState("");
  const [role, setRole] = useState(0);
  const [chainTime, setChainTime] = useState(0);
  const [busy, setBusy] = useState(false);
  const registryAddress = import.meta.env.VITE_REGISTRY_ADDRESS;
  const workflowAddress = import.meta.env.VITE_WORKFLOW_ADDRESS;

  const connect = useCallback(async () => {
    if (!window.ethereum) throw new Error("Instalo MetaMask për të vazhduar.");
    const p = new ethers.BrowserProvider(window.ethereum);
    const accounts = await p.send("eth_requestAccounts", []);
    const s = await p.getSigner();
    const network = await p.getNetwork();
    setProvider(p); setSigner(s); setAccount(accounts[0]); setChainId(Number(network.chainId));
  }, []);

  const contracts = useMemo(() => {
    if (!signer || !ethers.isAddress(registryAddress) || !ethers.isAddress(workflowAddress)) return {};
    return { registry: new ethers.Contract(registryAddress, registryAbi, signer), workflow: new ethers.Contract(workflowAddress, workflowAbi, signer) };
  }, [signer, registryAddress, workflowAddress]);

  const refresh = useCallback(async () => {
    if (!contracts.registry || !contracts.workflow) return;
    const [owner, categoryCount, requestCount, myRole, block] = await Promise.all([
      contracts.registry.owner(), contracts.registry.categoryCount(), contracts.workflow.requestCount(),
      contracts.registry.roleOf(account), provider.getBlock("latest")
    ]);
    const cats = await Promise.all(Array.from({ length: Number(categoryCount) }, async (_, i) => {
      const c = await contracts.registry.getCategory(i + 1);
      return { id: i + 1, name: c.name, slaHours: Number(c.slaHours), active: c.active };
    }));
    const base = Number(requestCount) ? (await contracts.workflow.getRequests(0, Number(requestCount))).map(normalize) : [];
    const [metas, assessments, verdicts] = await Promise.all([
      Promise.all(base.map((r) => contracts.workflow.getRequestMeta(r.id))),
      Promise.all(base.map((r) => contracts.workflow.getAiAssessment(r.id))),
      Promise.all(base.map((r) => contracts.workflow.currentAiVerdict(r.id)))
    ]);
    const items = base.map((r, i) => ({ ...r, ...normalizeMeta(metas[i]), ai: normalizeAi(assessments[i], verdicts[i]) }));
    // Afatet SLA krahasohen me kohën e blockchain-it, njësoj si kontrata.
    setMunicipality(owner); setRole(Number(myRole)); setChainTime(Number(block.timestamp));
    setCategories(cats); setRequests(items.reverse());
  }, [contracts, account, provider]);

  useEffect(() => { if (signer) refresh().catch(console.error); }, [signer, refresh]);
  useEffect(() => {
    if (!window.ethereum) return;
    const reset = () => window.location.reload();
    window.ethereum.on?.("accountsChanged", reset); window.ethereum.on?.("chainChanged", reset);
    return () => { window.ethereum.removeListener?.("accountsChanged", reset); window.ethereum.removeListener?.("chainChanged", reset); };
  }, []);

  const transact = async (factory) => {
    setBusy(true);
    try { const tx = await factory(); await tx.wait(); await refresh(); return tx; }
    finally { setBusy(false); }
  };
  const value = { account, provider, chainId, connect, contracts, requests, categories, municipality, role, chainTime, busy, refresh, transact };
  return <Web3Context.Provider value={value}>{children}</Web3Context.Provider>;
}
export const useWeb3 = () => useContext(Web3Context);
