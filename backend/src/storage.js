import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

// Ruajtja off-chain: IPFS (Kubo) kur është aktiv, përndryshe fallback lokal me CID të derivuar nga SHA-256.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const dataDir = path.join(__dirname, "..", "data");
export const LOCAL_CID = /^local-[a-f0-9]{64}$/;

export async function storeFile(buffer, name, type) {
  const ipfsApi = process.env.IPFS_API_URL;
  if (ipfsApi) {
    try {
      const form = new FormData();
      form.append("file", new Blob([buffer], { type }), name);
      const response = await fetch(`${ipfsApi.replace(/\/$/, "")}/api/v0/add?pin=true`, { method: "POST", body: form });
      if (!response.ok) throw new Error(`IPFS ${response.status}`);
      const result = await response.json();
      return { cid: result.Hash, storage: "ipfs", name: result.Name, size: Number(result.Size) };
    } catch (error) {
      console.warn("IPFS nuk u arrit; perdoret ruajtja lokale:", error.message);
    }
  }
  await fs.mkdir(dataDir, { recursive: true });
  const cid = `local-${crypto.createHash("sha256").update(buffer).digest("hex")}`;
  await fs.writeFile(path.join(dataDir, cid), buffer);
  await fs.writeFile(path.join(dataDir, `${cid}.json`), JSON.stringify({ name, type }));
  return { cid, storage: "local-fallback", name, size: buffer.length };
}

export async function storeJson(value, name) {
  return storeFile(Buffer.from(JSON.stringify(value, null, 2)), name, "application/json");
}

/// Lexon një skedar sipas CID: fallback lokal ose IPFS gateway. Kthen null nëse nuk gjendet.
export async function loadFile(cid) {
  if (!cid) return null;
  try {
    if (LOCAL_CID.test(cid)) {
      const meta = JSON.parse(await fs.readFile(path.join(dataDir, `${cid}.json`), "utf8"));
      return { buffer: await fs.readFile(path.join(dataDir, cid)), type: meta.type, name: meta.name };
    }
    const gateway = (process.env.IPFS_GATEWAY_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
    const response = await fetch(`${gateway}/ipfs/${encodeURIComponent(cid)}`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    return { buffer: Buffer.from(await response.arrayBuffer()), type: response.headers.get("content-type") || "application/octet-stream", name: cid };
  } catch {
    return null;
  }
}
