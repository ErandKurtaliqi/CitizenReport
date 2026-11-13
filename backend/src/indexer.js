import { ethers } from "ethers";
import { getContracts } from "./chain.js";

// Indeksues i eventeve: lexon log-et e te dy kontratave me eth_getLogs ne blloqe,
// i dekodon dhe i mban ne memorie per API. Rindertohet nga blloku fillestar ne cdo nisje.

const workflowEvents = new ethers.Interface([
  "event RequestSubmitted(uint256 indexed requestId, address indexed citizen, string descriptionCid)",
  "event RequestCategorized(uint256 indexed requestId, uint256 indexed categoryId)",
  "event ContractorAssigned(uint256 indexed requestId, address indexed contractor)",
  "event WorkStarted(uint256 indexed requestId, address indexed contractor)",
  "event WorkProofSubmitted(uint256 indexed requestId, string proofCid)",
  "event RequestVerified(uint256 indexed requestId, address indexed municipality)",
  "event RequestRejected(uint256 indexed requestId, string reasonCid)",
  "event RequestCancelled(uint256 indexed requestId, address indexed citizen)",
  "event RequestRated(uint256 indexed requestId, uint8 rating)",
  "event RequestEscalated(uint256 indexed requestId, address indexed escalatedBy, uint64 overdueSeconds)",
  "event ResolutionDisputed(uint256 indexed requestId, address indexed citizen, string evidenceCid)",
  "event RequestReopened(uint256 indexed requestId, address indexed operator)",
  "event DisputeDismissed(uint256 indexed requestId, address indexed supervisor, string reasonCid)",
  "event AiAssessmentRecorded(uint256 indexed requestId, uint8 verdict, uint8 confidence, bool sameLocation, string reportCid)",
  "event AiVerdictOverridden(uint256 indexed requestId, address indexed supervisor, string reasonCid)"
]);

const registryEvents = new ethers.Interface([
  "event OwnershipTransferStarted(address indexed currentOwner, address indexed pendingOwner)",
  "event OwnershipTransferred(address indexed previousOwner, address indexed newOwner)",
  "event CategoryAdded(uint256 indexed categoryId, string name, uint32 slaHours)",
  "event CategoryUpdated(uint256 indexed categoryId, string name, uint32 slaHours, bool active)",
  "event ContractorAuthorizationChanged(address indexed contractor, bool authorized)",
  "event OfficialRoleChanged(address indexed account, uint8 role)",
  "event AiOracleChanged(address indexed previousOracle, address indexed newOracle)"
]);

// Dëgjuesit marrin eventet e reja pas çdo sinkronizimi (p.sh. vlerësimi automatik me AI).
const listeners = [];
export function onNewEvents(listener) { listeners.push(listener); }

const state = {
  events: [],
  nextBlock: null,
  lastIndexedBlock: null,
  lastSyncAt: null,
  lastError: null,
  running: false,
  syncing: false
};

const startBlock = () => Math.max(0, Number(process.env.INDEXER_START_BLOCK || 0));
const blockRange = () => Math.max(1, Number(process.env.INDEXER_BLOCK_RANGE || 2000));
const pollMs = () => Math.max(1000, Number(process.env.INDEXER_POLL_MS || 4000));

function plain(value) {
  if (typeof value === "bigint") return Number(value);
  return value;
}

function decode(log, contractName, iface) {
  let parsed;
  try { parsed = iface.parseLog(log); } catch { return null; }
  if (!parsed) return null;
  const args = Object.fromEntries(parsed.fragment.inputs.map((input, index) => [input.name, plain(parsed.args[index])]));
  return {
    id: `${log.transactionHash}:${log.index}`,
    contract: contractName,
    event: parsed.name,
    requestId: args.requestId ?? null,
    args,
    blockNumber: log.blockNumber,
    transactionHash: log.transactionHash,
    logIndex: log.index,
    timestamp: null
  };
}

// Thirrjet paralele presin te njejtin sinkronizim ne vend qe te nisin nje tjeter.
let inflight = null;
function syncOnce() {
  if (!inflight) inflight = runSync().finally(() => { inflight = null; });
  return inflight;
}

async function runSync() {
  state.syncing = true;
  try {
    const { provider, workflow, registry } = getContracts();
    const [workflowAddress, registryAddress] = await Promise.all([workflow.getAddress(), registry.getAddress()]);
    const latest = await provider.getBlockNumber();

    // Hardhat node u rinis (zinxhiri u kthye mbrapa): rindertohet indeksi nga e para.
    if (state.lastIndexedBlock !== null && latest < state.lastIndexedBlock) {
      console.warn(`Indeksuesi: zinxhiri u rinis (blloku ${latest} < ${state.lastIndexedBlock}); po rindertohet.`);
      state.events = [];
      state.nextBlock = null;
      state.lastIndexedBlock = null;
    }
    if (state.nextBlock === null) state.nextBlock = startBlock();

    const timestamps = new Map();
    while (state.nextBlock <= latest) {
      const fromBlock = state.nextBlock;
      const toBlock = Math.min(latest, fromBlock + blockRange() - 1);
      const logs = await provider.getLogs({ address: [workflowAddress, registryAddress], fromBlock, toBlock });
      const decoded = logs
        .map((log) => log.address.toLowerCase() === workflowAddress.toLowerCase()
          ? decode(log, "ServiceRequestWorkflow", workflowEvents)
          : decode(log, "ServiceRegistry", registryEvents))
        .filter(Boolean);
      for (const item of decoded) {
        if (!timestamps.has(item.blockNumber)) {
          const block = await provider.getBlock(item.blockNumber);
          timestamps.set(item.blockNumber, block ? Number(block.timestamp) : null);
        }
        item.timestamp = timestamps.get(item.blockNumber);
      }
      state.events.push(...decoded);
      if (decoded.length) for (const listener of listeners) { try { listener(decoded); } catch (error) { console.warn("Indeksuesi:", error.message); } }
      state.lastIndexedBlock = toBlock;
      state.nextBlock = toBlock + 1;
    }
    state.lastSyncAt = new Date().toISOString();
    state.lastError = null;
  } catch (error) {
    state.lastError = error.shortMessage || error.message;
  } finally {
    state.syncing = false;
  }
}

export function startIndexer() {
  if (state.running) return;
  state.running = true;
  const loop = async () => {
    await syncOnce();
    setTimeout(loop, pollMs()).unref?.();
  };
  loop();
}

// Para cdo leximi nga API sinkronizohet njehere, qe pergjigjja te perfshije transaksionin e fundit.
export async function getEvents({ event, contract, requestId, address, limit } = {}) {
  await syncOnce();
  let items = state.events;
  if (event) items = items.filter((e) => e.event === event);
  if (contract) items = items.filter((e) => e.contract === contract);
  if (requestId !== undefined) items = items.filter((e) => e.requestId === Number(requestId));
  if (address) {
    const needle = String(address).toLowerCase();
    items = items.filter((e) => Object.values(e.args).some((v) => typeof v === "string" && v.toLowerCase() === needle));
  }
  items = [...items].sort((a, b) => b.blockNumber - a.blockNumber || b.logIndex - a.logIndex);
  const max = Math.min(500, Math.max(1, Number(limit || 100)));
  return items.slice(0, max);
}

export async function getRequestHistory(requestId) {
  await syncOnce();
  return state.events
    .filter((e) => e.contract === "ServiceRequestWorkflow" && e.requestId === Number(requestId))
    .sort((a, b) => a.blockNumber - b.blockNumber || a.logIndex - b.logIndex);
}

export function indexerStatus() {
  const counts = {};
  for (const e of state.events) counts[e.event] = (counts[e.event] || 0) + 1;
  return {
    running: state.running,
    startBlock: startBlock(),
    lastIndexedBlock: state.lastIndexedBlock,
    totalEvents: state.events.length,
    byEvent: counts,
    lastSyncAt: state.lastSyncAt,
    lastError: state.lastError
  };
}
