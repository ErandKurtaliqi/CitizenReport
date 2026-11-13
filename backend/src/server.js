import "dotenv/config";
import express from "express";
import cors from "cors";
import multer from "multer";
import { readAll, readCategories, chainTime, STATUS, OPEN_STATUSES } from "./chain.js";
import { startIndexer, getEvents, getRequestHistory, indexerStatus, onNewEvents } from "./indexer.js";
import { storeFile, loadFile, LOCAL_CID } from "./storage.js";
import { aiStatus, readAssessment, requestAssessment } from "./ai.js";

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 } });

app.use(cors({ origin: process.env.ALLOWED_ORIGIN || "http://localhost:5173" }));
app.use(express.json({ limit: "1mb" }));

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "komuna-api", time: new Date().toISOString() }));

app.get("/api/categories", async (_req, res, next) => {
  try { res.json(await readCategories()); } catch (error) { next(error); }
});

app.get("/api/requests", async (req, res, next) => {
  try {
    let items = await readAll();
    if (req.query.citizen) items = items.filter((item) => item.citizen.toLowerCase() === String(req.query.citizen).toLowerCase());
    if (req.query.contractor) items = items.filter((item) => item.contractor.toLowerCase() === String(req.query.contractor).toLowerCase());
    if (req.query.status !== undefined) items = items.filter((item) => item.status === Number(req.query.status));
    res.json(items);
  } catch (error) { next(error); }
});

app.get("/api/dashboard", async (_req, res, next) => {
  try {
    const [items, now] = await Promise.all([readAll(), chainTime()]);
    const byStatus = Object.fromEntries(STATUS.map((name, index) => [name, items.filter((r) => r.status === index).length]));
    const open = items.filter((r) => OPEN_STATUSES.includes(r.status));
    // Afati lexohet nga kontrata (dueAt); Disputed nuk ka afat SLA, pret vendimin e komunës.
    const timed = open.filter((r) => r.status !== 8);
    const overdue = timed.filter((r) => now > r.dueAt).length;
    const dueSoon = timed.filter((r) => now <= r.dueAt && r.dueAt - now < 6 * 3600).length;
    const escalated = open.filter((r) => r.escalated).length;
    const aiOverrides = (await getEvents({ event: "AiVerdictOverridden", limit: 500 })).length;
    const closed = items.filter((r) => r.closedAt > 0);
    const averageHours = closed.length
      ? closed.reduce((sum, r) => sum + (r.closedAt - r.createdAt) / 3600, 0) / closed.length : 0;
    const ratings = items.filter((r) => r.rating > 0);
    res.json({
      total: items.length, open: open.length, overdue, dueSoon, escalated, disputed: byStatus.Disputed, byStatus,
      chainTime: now, aiOverrides,
      averageResolutionHours: Number(averageHours.toFixed(1)),
      averageRating: ratings.length ? Number((ratings.reduce((s, r) => s + r.rating, 0) / ratings.length).toFixed(1)) : 0,
      generatedAt: new Date().toISOString()
    });
  } catch (error) { next(error); }
});

app.get("/api/events", async (req, res, next) => {
  try {
    const { event, contract, requestId, address, limit } = req.query;
    if (address && !/^0x[0-9a-fA-F]{40}$/.test(String(address))) return res.status(400).json({ error: "Adresa e pavlefshme" });
    if (requestId !== undefined && !/^\d+$/.test(String(requestId))) return res.status(400).json({ error: "requestId duhet te jete numer" });
    res.json(await getEvents({ event, contract, requestId, address, limit }));
  } catch (error) { next(error); }
});

app.get("/api/requests/:id/history", async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: "ID duhet te jete numer" });
    const history = await getRequestHistory(req.params.id);
    if (!history.length) return res.status(404).json({ error: "Nuk u gjet asnje event per kete kerkese" });
    res.json(history);
  } catch (error) { next(error); }
});

app.get("/api/indexer/status", (_req, res) => res.json(indexerStatus()));

app.post("/api/ipfs", upload.single("file"), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Skedari mungon" });
    res.status(201).json(await storeFile(req.file.buffer, req.file.originalname, req.file.mimetype));
  } catch (error) { next(error); }
});

app.get("/api/files/:cid", async (req, res, next) => {
  try {
    if (!LOCAL_CID.test(req.params.cid)) return res.status(404).json({ error: "Vetem CID lokale sherbehen nga kjo rruge" });
    const file = await loadFile(req.params.cid);
    if (!file) return res.status(404).json({ error: "Skedari nuk u gjet" });
    res.type(file.type).send(file.buffer);
  } catch (error) { next(error); }
});

// Versioni 3 - "Syri i tretë": vlerësimi i dëshmisë me AI, i nënshkruar nga oracle-i.
app.get("/api/ai/status", (_req, res) => res.json(aiStatus()));

app.get("/api/assess/:id", async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: "ID duhet te jete numer" });
    res.json(await readAssessment(Number(req.params.id)));
  } catch (error) { next(error); }
});

app.post("/api/assess/:id", async (req, res, next) => {
  try {
    if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ error: "ID duhet te jete numer" });
    const result = await requestAssessment(Number(req.params.id), { force: true });
    res.status(result.queued ? 202 : 200).json(result);
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.shortMessage || error.message || "Gabim i brendshem" });
});

const port = Number(process.env.PORT || 4000);
app.listen(port, () => {
  console.log(`Komuna API: http://localhost:${port}`);
  // Sapo kontraktuesi dorëzon dëshminë, "syri i tretë" e vlerëson automatikisht.
  if (process.env.AI_AUTO_ASSESS !== "false") {
    onNewEvents((events) => {
      for (const e of events) {
        if (e.event === "WorkProofSubmitted") requestAssessment(e.requestId).catch((error) => console.warn(`AI #${e.requestId}:`, error.message));
      }
    });
  }
  startIndexer();
});
