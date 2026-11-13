import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { Activity, AlertTriangle, Building2, ClipboardList, HardHat, Home, Menu, Plus, ShieldCheck, Wallet, X } from "lucide-react";
import { ethers } from "ethers";
import { ROLES, STATUSES, useWeb3 } from "./web3.jsx";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000/api";
const ZERO = ethers.ZeroAddress.toLowerCase();
const OPEN = [0, 1, 2, 3, 4];
const DISPUTE_WINDOW = 7 * 24 * 3600;
const MAX_DISPUTES = 2;
const ROLE_NAMES = { [ROLES.OPERATOR]: "Operator", [ROLES.SUPERVISOR]: "Mbikëqyrës" };

function short(value = "") { return value ? `${value.slice(0, 6)}…${value.slice(-4)}` : "—"; }
function date(ts) { return ts ? new Intl.DateTimeFormat("sq-AL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(ts * 1000)) : "—"; }
function errorText(error) { return error?.shortMessage || error?.reason || error?.message || "Veprimi dështoi"; }
function same(a = "", b = "") { return a.toLowerCase() === b.toLowerCase(); }
function Status({ value }) { return <span className={`status s${value}`}>{STATUSES[value]}</span>; }
function duration(seconds) {
  const h = Math.floor(seconds / 3600);
  if (h >= 48) return `${Math.floor(h / 24)} ditë`;
  if (h >= 1) return `${h} orë`;
  return `${Math.max(1, Math.floor(seconds / 60))} min`;
}

// Afati SLA i kërkesës, krahasuar me kohën e blockchain-it.
function Sla({ item, now }) {
  if (!OPEN.includes(item.status) || !item.dueAt || !now) return item.escalated && OPEN.includes(item.status) ? <span className="sla late">Eskaluar</span> : null;
  const left = item.dueAt - now;
  if (left < 0) return <span className="sla late">{item.escalated ? "🔴 Eskaluar · " : "🔴 "}Jashtë afatit {duration(-left)}</span>;
  return <span className={left < 6 * 3600 ? "sla soon" : "sla"}>⏱ {duration(left)} të mbetura</span>;
}

// ---- Versioni 3: "Syri i tretë" ----
const AI_LABELS = { Resolved: ["E zgjidhur", "ok"], NotResolved: ["E pazgjidhur", "bad"], Inconclusive: ["E pasigurt", "unsure"] };
function fileUrl(cid) {
  if (!cid) return null;
  if (cid.startsWith("local-")) return `${API}/files/${cid}`;
  if (cid.startsWith("seed-") || cid.startsWith("bafy-demo") || cid.startsWith("bafy-proof")) return null; // të dhëna demo pa skedar
  return `https://ipfs.io/ipfs/${cid}`;
}
function isDemoReport(cid = "") { return cid.startsWith("seed-demo"); }

function Photo({ cid, label }) {
  const [failed, setFailed] = useState(false);
  const url = fileUrl(cid);
  return <figure className="ai-photo"><figcaption>{label}</figcaption>{url && !failed ? <img src={url} alt={label} onError={() => setFailed(true)} /> : <div className="photo-missing">{cid ? "Foto demo pa skedar" : "Pa foto"}</div>}</figure>;
}

function AiBadge({ ai }) {
  if (!ai) return <span className="ai-badge none">🤖 Pa vlerësim AI</span>;
  if (!ai.current) return <span className="ai-badge none">🤖 Vlerësimi i vjetër nuk vlen për dëshminë e re</span>;
  const [label, tone] = AI_LABELS[ai.verdict] || [ai.verdict, "unsure"];
  return <span className={`ai-badge ${tone}`}>🤖 AI: {label}{ai.confidence ? ` (${ai.confidence}%)` : ""}</span>;
}

/// Karta e mbikëqyrësit: fotot para/pas, vlerësimi i AI-së dhe verifikimi (normal ose kundër AI-së me arsyetim).
function AiCard({ item, canVerify, blockedReason, canReassess = true }) {
  const { contracts, transact, busy, refresh } = useWeb3();
  const [beforeCid, setBeforeCid] = useState(null); const [report, setReport] = useState(null);
  const [pending, setPending] = useState(false); const [reason, setReason] = useState(""); const [message, setMessage] = useState("");
  const ai = item.ai?.current ? item.ai : null;
  useEffect(() => {
    if (item.descriptionCid?.startsWith("local-")) fetch(`${API}/files/${item.descriptionCid}`).then((r) => r.ok ? r.json() : null).then((m) => setBeforeCid(m?.attachmentCid || null)).catch(() => {});
    fetch(`${API}/assess/${item.id}`).then((r) => r.ok ? r.json() : null).then((d) => { setReport(d?.report || null); setPending(Boolean(d?.pending)); }).catch(() => {});
  }, [item.id, item.descriptionCid, item.ai?.reportCid]);
  useEffect(() => {
    if (!pending) return undefined;
    const timer = setInterval(() => fetch(`${API}/assess/${item.id}`).then((r) => r.json()).then((d) => { if (!d.pending) { setPending(false); setReport(d.report); refresh(); } }).catch(() => {}), 3000);
    return () => clearInterval(timer);
  }, [pending, item.id, refresh]);
  const reassess = async () => { setMessage(""); setPending(true); try {
    const r = await fetch(`${API}/assess/${item.id}`, { method: "POST" }); const d = await r.json();
    if (!r.ok) throw new Error(d.error); await refresh();
  } catch (e) { setMessage(errorText(e)); } finally { setPending(false); } };
  const verify = () => transact(() => contracts.workflow.verifyResolution(item.id)).catch((e) => alert(errorText(e)));
  const override = async () => { setMessage(""); try {
    const file = new File([JSON.stringify({ requestId: item.id, reason, aiReportCid: item.ai?.reportCid, createdAt: new Date().toISOString() }, null, 2)], "arsyetim-kunder-ai.json", { type: "application/json" });
    const cid = await upload(file);
    await transact(() => contracts.workflow.verifyAgainstAi(item.id, cid));
  } catch (e) { setMessage(errorText(e)); } };
  const rejected = ai?.verdict === "NotResolved";
  return <div className="ai-card">
    <div className="ai-photos"><Photo cid={beforeCid} label="PARA · qytetari" /><Photo cid={item.workProofCid} label="PAS · kontraktuesi" /></div>
    <div className="ai-verdict">
      <h4>Syri i tretë</h4>
      {pending ? <span className="ai-badge none">🤖 Duke vlerësuar…</span> : <AiBadge ai={item.ai} />}
      {ai && ai.confidence > 0 && <div className="confidence"><div style={{ width: `${ai.confidence}%` }} /></div>}
      {ai && <p className="hint">{ai.sameLocation ? "✓ I njëjti vend" : "✗ Vendi nuk përputhet ose s'u verifikua"}</p>}
      {report?.reason && <p className="ai-reason">"{report.reason}"</p>}
      {report?.provider === "mock" && <p className="hint">Simulim, pa AI reale. {report.note}</p>}
      {isDemoReport(item.ai?.reportCid) && <p className="hint">Të dhëna demo nga seed-i, të nënshkruara nga oracle-i lokal.</p>}
      {report && <p className="hint">{report.provider}{report.model ? ` · ${report.model}` : ""} · oracle <span className="mono">{short(report.oracle)}</span> · <a href={fileUrl(item.ai.reportCid)} target="_blank" rel="noreferrer">raporti ↗</a></p>}
      {message && <div className="notice">{message}</div>}
      <div className="ai-actions">
        {canReassess && <button className="ghost" disabled={pending} onClick={reassess}>Rivlerëso</button>}
        {canVerify && !rejected && <button disabled={busy || Boolean(blockedReason)} onClick={verify}>Verifiko dhe mbyll</button>}
      </div>
      {canVerify && rejected && <div className="override"><b>AI mendon që problemi nuk është zgjidhur.</b><span>Mund ta verifikosh gjithsesi, por arsyetimi do të jetë publik përgjithmonë.</span><textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Pse e verifikon kundër AI-së?" /><button className="danger" disabled={busy || reason.trim().length < 10 || Boolean(blockedReason)} onClick={override}>Verifiko kundër AI-së</button></div>}
      {blockedReason && <small className="blocked">{blockedReason}</small>}
    </div>
  </div>;
}

async function upload(file) {
  if (!file) throw new Error("Zgjidh një fotografi ose raport.");
  const form = new FormData(); form.append("file", file);
  const response = await fetch(`${API}/ipfs`, { method: "POST", body: form });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Ngarkimi dështoi");
  return data.cid;
}

function Shell({ children }) {
  const { account, connect, chainId } = useWeb3();
  const [open, setOpen] = useState(false);
  const expected = Number(import.meta.env.VITE_EXPECTED_CHAIN_ID || 31337);
  const links = [["/", Home, "Ballina"], ["/new", Plus, "Kërkesë e re"], ["/mine", ClipboardList, "Kërkesat e mia"], ["/municipality", Building2, "Komuna"], ["/contractor", HardHat, "Kontraktuesi"]];
  return <div className="app-shell">
    <aside className={open ? "sidebar open" : "sidebar"}>
      <div className="brand"><div className="brand-mark"><ShieldCheck /></div><div><strong>Komuna</strong><span>Transparente</span></div></div>
      <button className="close-menu" onClick={() => setOpen(false)}><X /></button>
      <nav>{links.map(([to, Icon, label]) => <NavLink key={to} to={to} end={to === "/"} onClick={() => setOpen(false)}><Icon />{label}</NavLink>)}</nav>
      <div className="chain-note"><Activity /> <div><span>Rrjeti aktiv</span><strong>{chainId ? `Chain ${chainId}` : "Pa lidhje"}</strong></div></div>
    </aside>
    <main>
      <header><button className="menu" onClick={() => setOpen(true)}><Menu /></button><div className="header-copy"><span>Shërbime publike, të gjurmueshme</span>{chainId && chainId !== expected && <b className="network-warning">Rrjet i gabuar</b>}</div>
        <button className="wallet" onClick={() => connect().catch((e) => alert(errorText(e)))}><Wallet />{account ? short(account) : "Lidh MetaMask"}</button></header>
      <div className="content">{children}</div>
    </main>
  </div>;
}

function ConnectGate({ children }) {
  const { account, connect } = useWeb3();
  if (account) return children;
  return <div className="empty"><Wallet /><h2>Lidhe portofolin</h2><p>MetaMask nevojitet për të lexuar dhe nënshkruar transaksionet.</p><button className="primary" onClick={() => connect().catch((e) => alert(errorText(e)))}>Lidh MetaMask</button></div>;
}

function Dashboard() {
  const { requests, categories, account, chainTime } = useWeb3();
  const [stats, setStats] = useState(null);
  const [publicRequests, setPublicRequests] = useState([]);
  const [publicCategories, setPublicCategories] = useState([]);
  useEffect(() => {
    Promise.all([
      fetch(`${API}/dashboard`).then((r) => r.ok ? r.json() : null),
      fetch(`${API}/requests`).then((r) => r.ok ? r.json() : []),
      fetch(`${API}/categories`).then((r) => r.ok ? r.json() : [])
    ]).then(([dashboard, items, cats]) => { setStats(dashboard); setPublicRequests(items.reverse()); setPublicCategories(cats); }).catch(() => {});
  }, [requests]);
  const visibleRequests = account ? requests : publicRequests;
  const visibleCategories = account ? categories : publicCategories;
  const now = (account && chainTime) || stats?.chainTime || 0;
  const total = stats?.total ?? visibleRequests.length;
  const open = stats?.open ?? visibleRequests.filter((r) => OPEN.includes(r.status) || r.status === 8).length;
  const verified = stats?.byStatus?.Verified ?? visibleRequests.filter((r) => r.status === 5).length;
  return <>
    <section className="hero"><div><span className="eyebrow">PORTAL QYTETAR</span><h1>Problemi yt.<br/><em>Gjurmë publike.</em></h1><p>Raporto ndriçimin, ujësjellësin ose dëmtimet e rrugëve. Çdo hap ruhet në blockchain.</p><Link className="primary" to="/new"><Plus /> Raporto problem</Link></div><div className="hero-orbit"><div className="orb"><ShieldCheck /></div><span className="orbit one">IPFS</span><span className="orbit two">SLA</span><span className="orbit three">WEB3</span></div></section>
    <section className="metrics"><article><span>Kërkesa gjithsej</span><strong>{total}</strong><small>Në blockchain</small></article><article><span>Të hapura</span><strong>{open}</strong><small>{stats?.disputed ? `${stats.disputed} të kontestuara` : "Në proces"}</small></article><article><span>Të verifikuara</span><strong>{verified}</strong><small>{stats?.aiOverrides ? `${stats.aiOverrides} kundër AI-së` : "Zgjidhje të dëshmuara"}</small></article><article><span>Jashtë SLA</span><strong>{stats?.overdue ?? 0}</strong><small>{stats?.escalated ? `${stats.escalated} të eskaluara publikisht` : "Kërkojnë vëmendje"}</small></article></section>
    <section className="section-head"><div><span className="eyebrow">TRANSPARENCA</span><h2>Aktiviteti i fundit</h2></div><span>{visibleCategories.length} kategori aktive · {account ? "nga blockchain" : "nga API"}</span></section>
    <RequestTable items={visibleRequests.slice(0, 6)} categories={visibleCategories} now={now} />
  </>;
}

function RequestTable({ items, categories, now }) {
  const name = (id) => categories.find((c) => c.id === id)?.name || "Pa kategori";
  if (!items.length) return <div className="empty compact"><ClipboardList /><p>Nuk ka kërkesa për t’u shfaqur.</p></div>;
  return <div className="table-wrap"><table><thead><tr><th>ID</th><th>Kategoria</th><th>Statusi</th><th>Afati SLA</th><th>Qytetari</th><th>Data</th><th></th></tr></thead><tbody>{items.map((r) => <tr key={r.id}><td><b>#{r.id}</b></td><td>{name(r.categoryId)}</td><td><Status value={r.status} /></td><td><Sla item={r} now={now} /></td><td className="mono">{short(r.citizen)}</td><td>{date(r.createdAt)}</td><td><Link to={`/request/${r.id}`}>Hap →</Link></td></tr>)}</tbody></table></div>;
}

function NewRequest() {
  const { contracts, categories, transact, busy } = useWeb3();
  const [form, setForm] = useState({ description: "", location: "" });
  const [file, setFile] = useState(null); const [message, setMessage] = useState(""); const navigate = useNavigate();
  const submit = async (e) => { e.preventDefault(); setMessage(""); try {
    const attachmentCid = file ? await upload(file) : "";
    const metadata = new File([JSON.stringify({ description: form.description, categoryHint: form.categoryHint || "", attachmentName: file?.name || "", attachmentCid, createdAt: new Date().toISOString() }, null, 2)], "kerkesa.json", { type: "application/json" });
    const metadataCid = await upload(metadata);
    await transact(() => contracts.workflow.submitRequest(metadataCid, form.location));
    setMessage("Kërkesa u regjistrua me sukses."); setTimeout(() => navigate("/mine"), 700);
  } catch (error) { setMessage(errorText(error)); }};
  return <ConnectGate><div className="page-head"><span className="eyebrow">HAPI I PARË</span><h1>Raporto një problem</h1><p>Të dhënat ruhen off-chain; CID dhe gjurma e procesit ruhen në blockchain. Komuna ka 48 orë ta pranojë kërkesën.</p></div>
    <form className="form-card" onSubmit={submit}><label>Përshkrimi<textarea required minLength="12" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Përshkruaje problemin, p.sh. llamba e rrugës nuk punon…" /></label>
      <div className="form-row"><label>Kategoria e sugjeruar<select value={form.categoryHint || ""} onChange={(e) => setForm({ ...form, categoryHint: e.target.value })}><option value="">Zgjidhe</option>{categories.map((c) => <option key={c.id}>{c.name}</option>)}</select></label><label>Lokacioni<input required value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Lagjja / koordinatat" /></label></div>
      <label>Dëshmi fotografike / raport<input type="file" accept="image/*,.pdf" onChange={(e) => setFile(e.target.files[0])} /><small>Maksimumi 8 MB. Ngarkohet në IPFS ose fallback lokal. Mos ngarko fytyra apo targa makinash.</small></label>
      {message && <div className="notice">{message}</div>}<button className="primary" disabled={busy}>{busy ? "Duke regjistruar…" : "Regjistro në blockchain"}</button></form></ConnectGate>;
}

function DisputeForm({ item, onDone }) {
  const { contracts, transact, busy } = useWeb3();
  const [file, setFile] = useState(null); const [note, setNote] = useState(""); const [message, setMessage] = useState("");
  const submit = async () => { setMessage(""); try {
    const photoCid = file ? await upload(file) : "";
    const evidence = new File([JSON.stringify({ requestId: item.id, note, photoCid, createdAt: new Date().toISOString() }, null, 2)], "kontestim.json", { type: "application/json" });
    const evidenceCid = await upload(evidence);
    await transact(() => contracts.workflow.disputeResolution(item.id, evidenceCid));
    onDone();
  } catch (error) { setMessage(errorText(error)); }};
  return <div className="dispute-form"><textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Pse nuk është zgjidhur problemi? p.sh. llamba ende nuk punon" /><input type="file" accept="image/*" onChange={(e) => setFile(e.target.files[0])} />{message && <div className="notice">{message}</div>}<button className="primary small" disabled={busy || note.length < 5} onClick={submit}>{busy ? "Duke dërguar…" : "Dërgo kontestimin"}</button></div>;
}

function Mine() {
  const { account, requests, categories, contracts, transact, busy, chainTime } = useWeb3();
  const [disputing, setDisputing] = useState(null);
  const mine = requests.filter((r) => same(r.citizen, account));
  const cancel = (id) => transact(() => contracts.workflow.cancelRequest(id)).catch((e) => alert(errorText(e)));
  const rate = (id, value) => transact(() => contracts.workflow.rateResolution(id, value)).catch((e) => alert(errorText(e)));
  const canDispute = (r) => r.status === 5 && !r.rating && r.disputeCount < MAX_DISPUTES && chainTime <= r.closedAt + DISPUTE_WINDOW;
  return <ConnectGate><div className="page-head"><span className="eyebrow">PORTOFOLI IM</span><h1>Kërkesat e mia</h1><p>Ndiq statusin, anulo kërkesat ende të papranuara, vlerëso zgjidhjen ose kontestoje brenda 7 ditëve nëse problemi mbetet.</p></div>
    <div className="cards">{mine.map((r) => <article className={r.status === 8 ? "request-card disputed" : "request-card"} key={r.id}><div><span>#{r.id}</span><Status value={r.status} /></div><h3>{categories.find((c) => c.id === r.categoryId)?.name || "Në pritje të kategorizimit"}</h3><p>{r.locationHash}</p><small>{date(r.createdAt)} · CID {short(r.descriptionCid)}</small><div className="card-sla"><Sla item={r} now={chainTime} /></div>
      {r.status === 8 && <p className="hint">Kontestimi u dërgua. Komuna duhet ta rihapë kërkesën ose ta arsyetojë vendimin.</p>}
      {canDispute(r) && <p className="hint">Mund ta kontestosh edhe {duration(r.closedAt + DISPUTE_WINDOW - chainTime)}. Vlerësimi e bën zgjidhjen përfundimtare.</p>}
      <div className="actions"><Link to={`/request/${r.id}`}>Detajet</Link>{r.status === 0 && <button disabled={busy} onClick={() => cancel(r.id)}>Anulo</button>}{r.status === 5 && !r.rating && <select defaultValue="" onChange={(e) => rate(r.id, Number(e.target.value))}><option value="" disabled>Vlerëso</option>{[5,4,3,2,1].map((n) => <option key={n} value={n}>{n}/5</option>)}</select>}{canDispute(r) && <button className="warn" onClick={() => setDisputing(disputing === r.id ? null : r.id)}>Kontesto zgjidhjen</button>}</div>
      {disputing === r.id && <DisputeForm item={r} onDone={() => setDisputing(null)} />}
    </article>)}</div>{!mine.length && <div className="empty compact">Nuk ke ende kërkesa.</div>}</ConnectGate>;
}

function AdminPanel() {
  const { contracts, transact, busy } = useWeb3();
  const [official, setOfficial] = useState(""); const [roleValue, setRoleValue] = useState("1"); const [contractor, setContractor] = useState("");
  const run = (fn) => transact(fn).catch((e) => alert(errorText(e)));
  return <section className="admin-panel"><h3>Administrimi</h3><p>Vetëm administratori emëron zyrtarët. Një kontraktues nuk mund të jetë zyrtar.</p>
    <div className="inline-form"><input value={official} onChange={(e) => setOfficial(e.target.value)} placeholder="Adresa 0x e zyrtarit"/><select value={roleValue} onChange={(e) => setRoleValue(e.target.value)}><option value="1">Operator</option><option value="2">Mbikëqyrës</option><option value="0">Hiq rolin</option></select><button disabled={busy} onClick={() => run(() => contracts.registry.setOfficial(official, Number(roleValue)))}>Cakto rolin</button></div>
    <div className="inline-form"><input value={contractor} onChange={(e) => setContractor(e.target.value)} placeholder="Adresa 0x e kontraktuesit"/><button disabled={busy} onClick={() => run(() => contracts.registry.setContractor(contractor, true))}>Autorizo kontraktues</button></div>
  </section>;
}

function Municipality() {
  const { account, municipality, role, requests, categories, contracts, transact, busy, chainTime } = useWeb3();
  const [values, setValues] = useState({});
  const isAdmin = same(account, municipality);
  const isOperator = role === ROLES.OPERATOR; const isSupervisor = role === ROLES.SUPERVISOR;
  const set = (id, key, value) => setValues((v) => ({ ...v, [id]: { ...v[id], [key]: value } }));
  const run = (fn) => transact(fn).catch((e) => alert(errorText(e)));
  const relevant = useMemo(() => requests
    .filter((r) => (isOperator && [0, 1, 8].includes(r.status)) || (isSupervisor && [4, 8].includes(r.status)) || [2, 3].includes(r.status))
    .sort((a, b) => Number(b.escalated) - Number(a.escalated) || (a.dueAt || 0) - (b.dueAt || 0)), [requests, isOperator, isSupervisor]);
  if (!account) return <ConnectGate />;
  if (!isAdmin && !isOperator && !isSupervisor) return <div className="empty"><Building2 /><h2>Qasje vetëm për zyrtarët e komunës</h2><p>Kjo adresë nuk ka rol operator ose mbikëqyrës. Administratori: {short(municipality)}.</p></div>;
  return <div><div className="page-head"><span className="eyebrow">PANELI ZYRTAR</span><h1>Menaxhimi komunal</h1><p>Parimi "katër sy": operatori kategorizon dhe cakton, mbikëqyrësi verifikon. Askush nuk verifikon punën që e ka caktuar vetë.</p>
      <div className="role-badges">{isAdmin && <span className="role-badge admin">Administrator</span>}{ROLE_NAMES[role] && <span className="role-badge">{ROLE_NAMES[role]}</span>}</div></div>
    {isAdmin && <AdminPanel />}
    <div className="workflow-list">{relevant.map((r) => {
      const ownAssignment = same(r.assignedBy, account); const ownVerification = same(r.verifiedBy, account);
      return <article key={r.id} className={r.escalated || (OPEN.includes(r.status) && chainTime > r.dueAt) ? "escalated" : ""}><div className="workflow-title"><b>#{r.id}</b><Status value={r.status}/><Sla item={r} now={chainTime} /><span>{r.locationHash}</span><Link to={`/request/${r.id}`}>Detajet →</Link></div>
      {isOperator && r.status === 0 && <div className="inline-form"><select onChange={(e) => set(r.id, "category", e.target.value)} defaultValue=""><option value="" disabled>Kategoria</option>{categories.filter((c) => c.active).map((c) => <option value={c.id} key={c.id}>{c.name} ({c.slaHours}h)</option>)}</select><button disabled={busy} onClick={() => run(() => contracts.workflow.categorizeRequest(r.id, values[r.id]?.category))}>Kategorizo</button><input placeholder="CID arsye refuzimi" onChange={(e) => set(r.id, "reason", e.target.value)}/><button className="danger" onClick={() => run(() => contracts.workflow.rejectRequest(r.id, values[r.id]?.reason))}>Refuzo</button></div>}
      {isOperator && r.status === 1 && <div className="inline-form"><input placeholder="Adresa e kontraktuesit" onChange={(e) => set(r.id, "contractor", e.target.value)}/><button onClick={() => run(() => contracts.workflow.assignContractor(r.id, values[r.id]?.contractor))}>Cakto</button></div>}
      {[2, 3].includes(r.status) && <p className="hint">Te kontraktuesi {short(r.contractor)} · caktuar nga {short(r.assignedBy)}</p>}
      {r.status === 4 && <AiCard item={r} canVerify={isSupervisor} blockedReason={isSupervisor && ownAssignment ? "Nuk mund ta verifikosh punën që e ke caktuar vetë" : ""} />}
      {r.status === 8 && <div className="dispute-box"><span>Kontestim nga qytetari ({r.disputeCount}/{MAX_DISPUTES}) · dëshmia: <b>{short(r.disputeCid)}</b> · dëshmia e punës: <b>{short(r.workProofCid)}</b></span>
        {isOperator && <button disabled={busy} onClick={() => run(() => contracts.workflow.reopenRequest(r.id))}>Rihap kërkesën</button>}
        {isSupervisor && <div className="inline-form"><input placeholder="CID arsyetimi" onChange={(e) => set(r.id, "dismiss", e.target.value)}/><button className="danger" disabled={busy || ownVerification} onClick={() => run(() => contracts.workflow.dismissDispute(r.id, values[r.id]?.dismiss))}>Hidh poshtë kontestimin</button>{ownVerification && <small className="blocked">E ke verifikuar vetë; vendos një mbikëqyrës tjetër</small>}</div>}
      </div>}
    </article>; })}</div>{!relevant.length && <div className="empty compact">Nuk ka kërkesa që presin veprimin tënd.</div>}</div>;
}

function Contractor() {
  const { account, requests, contracts, transact, busy } = useWeb3(); const [files, setFiles] = useState({});
  const items = requests.filter((r) => same(r.contractor, account) && [2,3,4].includes(r.status));
  const run = (fn) => transact(fn).catch((e) => alert(errorText(e)));
  const proof = async (r) => { try { const cid = await upload(files[r.id]); await run(() => contracts.workflow.submitWorkProof(r.id, cid)); } catch (e) { alert(errorText(e)); } };
  return <ConnectGate><div className="page-head"><span className="eyebrow">EKIPI NË TERREN</span><h1>Detyrat e kontraktuesit</h1><p>Fillo punën dhe dorëzo dëshmi përpara se komuna ta verifikojë zgjidhjen.</p></div><div className="workflow-list">{items.map((r) => <article key={r.id}><div className="workflow-title"><b>#{r.id}</b><Status value={r.status}/>{r.disputeCount > 0 && <span className="sla late">Rihapur pas kontestimit</span>}<span>{r.locationHash}</span></div>{r.status === 2 && <button className="primary small" disabled={busy} onClick={() => run(() => contracts.workflow.startWork(r.id))}>Fillo punën</button>}{r.status === 3 && <div className="inline-form"><input type="file" onChange={(e) => setFiles({ ...files, [r.id]: e.target.files[0] })}/><button onClick={() => proof(r)}>Dorëzo dëshminë</button></div>}{r.status === 4 && <p>Në pritje të verifikimit nga komuna.</p>}</article>)}</div>{!items.length && <div className="empty compact">Nuk ka detyra aktive për këtë adresë.</div>}</ConnectGate>;
}

const EVENT_LABELS = {
  RequestSubmitted: ["E paraqitur", "citizen", "s0"],
  RequestCategorized: ["E kategorizuar", null, "s1"],
  ContractorAssigned: ["Kontraktues i caktuar", "contractor", "s2"],
  WorkStarted: ["Puna filloi", "contractor", "s3"],
  WorkProofSubmitted: ["Dëshmia e punës u dorëzua", null, "s4"],
  RequestVerified: ["E verifikuar", "municipality", "s5"],
  RequestRejected: ["E refuzuar", null, "s6"],
  RequestCancelled: ["E anuluar nga qytetari", "citizen", "s7"],
  RequestRated: ["Vlerësim", null, "s5"],
  RequestEscalated: ["Eskaluar publikisht për vonesë", "escalatedBy", "s6"],
  ResolutionDisputed: ["Zgjidhja u kontestua", "citizen", "s8"],
  RequestReopened: ["Rihapur nga operatori", "operator", "s2"],
  DisputeDismissed: ["Kontestimi u hodh poshtë", "supervisor", "s5"],
  AiAssessmentRecorded: ["🤖 Vlerësimi i AI-së (i nënshkruar nga oracle-i)", null, "ai"],
  AiVerdictOverridden: ["⚠️ Verifikuar kundër AI-së", "supervisor", "s6"]
};
const AI_EVENT_VERDICTS = { 1: "e zgjidhur", 2: "e pazgjidhur", 3: "e pasigurt" };

function eventDetail(e, categories) {
  const a = e.args;
  if (e.event === "RequestCategorized") return categories.find((c) => c.id === a.categoryId)?.name || `Kategoria ${a.categoryId}`;
  if (e.event === "WorkProofSubmitted") return `CID ${short(a.proofCid)}`;
  if (e.event === "RequestRejected") return `Arsyeja ${short(a.reasonCid)}`;
  if (e.event === "RequestRated") return `${"⭐".repeat(a.rating)} ${a.rating}/5`;
  if (e.event === "RequestEscalated") return `${duration(a.overdueSeconds)} vonesë`;
  if (e.event === "ResolutionDisputed") return `Dëshmia ${short(a.evidenceCid)}`;
  if (e.event === "DisputeDismissed") return `Arsyetimi ${short(a.reasonCid)}`;
  if (e.event === "AiAssessmentRecorded") return `${AI_EVENT_VERDICTS[a.verdict] || "?"}${a.confidence ? ` (${a.confidence}%)` : ""} · ${a.sameLocation ? "i njëjti vend" : "vendi pa përputhje"}${isDemoReport(a.reportCid) ? " · demo" : ""}`;
  if (e.event === "AiVerdictOverridden") return `Arsyetimi publik ${short(a.reasonCid)}`;
  return "";
}

function Timeline({ id, categories }) {
  const { chainId } = useWeb3();
  const [events, setEvents] = useState(null);
  const { requests } = useWeb3();
  useEffect(() => {
    fetch(`${API}/requests/${id}/history`).then((r) => r.ok ? r.json() : []).then(setEvents).catch(() => setEvents([]));
  }, [id, requests]);
  if (events === null) return null;
  if (!events.length) return <div className="empty compact">Historiku nuk është i disponueshëm (backend-i nuk po indekson).</div>;
  const explorer = chainId === 11155111 ? "https://sepolia.etherscan.io/tx/" : null;
  return <ol className="timeline">{events.map((e) => {
    const [label, actorKey, tone] = EVENT_LABELS[e.event] || [e.event, null, ""];
    const actor = actorKey ? e.args[actorKey] : null;
    return <li key={e.id} className={tone}><div className="dot" /><div><b>{label}</b><span>{date(e.timestamp)}{actor && <> · <span className="mono">{short(actor)}</span></>}</span>{eventDetail(e, categories) && <em>{eventDetail(e, categories)}</em>}
      <small className="mono">tx {explorer ? <a href={explorer + e.transactionHash} target="_blank" rel="noreferrer">{short(e.transactionHash)} ↗</a> : short(e.transactionHash)} · blloku {e.blockNumber}</small></div></li>;
  })}</ol>;
}

function Detail() {
  const { requests, categories: chainCategories, account, contracts, transact, busy, chainTime } = useWeb3(); const { id } = useParams();
  const [publicItem, setPublicItem] = useState(null); const [stats, setStats] = useState(null); const [publicCategories, setPublicCategories] = useState([]);
  const fromChain = requests.find((r) => r.id === Number(id));
  useEffect(() => {
    if (fromChain) return;
    // Pa MetaMask faqja lexon nga API-ja, që detajet të jenë publike.
    fetch(`${API}/requests`).then((r) => r.ok ? r.json() : []).then((items) => setPublicItem(items.find((r) => r.id === Number(id)) || null)).catch(() => {});
    fetch(`${API}/dashboard`).then((r) => r.ok ? r.json() : null).then(setStats).catch(() => {});
    fetch(`${API}/categories`).then((r) => r.ok ? r.json() : []).then(setPublicCategories).catch(() => {});
  }, [id, fromChain]);
  const item = fromChain || publicItem;
  const categories = chainCategories.length ? chainCategories : publicCategories;
  const now = chainTime || stats?.chainTime || 0;
  if (!item) return <div className="empty compact">Kërkesa nuk u gjet.</div>;
  const overdue = OPEN.includes(item.status) && item.dueAt && now > item.dueAt;
  const escalate = () => transact(() => contracts.workflow.escalate(item.id)).catch((e) => alert(errorText(e)));
  const rows = [["Qytetari", item.citizen], ["Kategoria", categories.find((c) => c.id === item.categoryId)?.name || "Pa kategori"], ["Kontraktuesi", same(item.contractor, ZERO) ? "Pa caktuar" : item.contractor],
    ["Caktuar nga", item.assignedBy && !same(item.assignedBy, ZERO) ? item.assignedBy : "—"], ["Verifikuar nga", item.verifiedBy && !same(item.verifiedBy, ZERO) ? item.verifiedBy : "—"],
    ["Lokacioni", item.locationHash], ["Metadata CID", item.descriptionCid], ["Dëshmi CID", item.workProofCid || "Pa dëshmi"],
    ["Vlerësimi i AI", item.ai ? `${(AI_LABELS[item.ai.verdict] || [item.ai.verdict])[0]}${item.ai.confidence ? ` · ${item.ai.confidence}%` : ""}${item.ai.current ? "" : " (për dëshminë e mëparshme)"}` : "—"],
    ["Afati SLA", OPEN.includes(item.status) ? date(item.dueAt) : "—"], ["Eskaluar", item.escalated ? "Po" : "Jo"], ["Kontestime", `${item.disputeCount || 0}/${MAX_DISPUTES}`],
    ["Krijuar", date(item.createdAt)], ["Mbyllur", date(item.closedAt)], ["Vlerësimi", item.rating ? `${item.rating}/5` : "Pa vlerësim"]];
  return <div><div className="page-head"><span className="eyebrow">GJURMË E AUDITUESHME</span><h1>Kërkesa #{item.id}</h1><div className="head-row"><Status value={item.status}/><Sla item={item} now={now} /></div></div>
    {overdue && !item.escalated && <div className="escalate-box"><AlertTriangle /><div><b>Kjo kërkesë ka kaluar afatin SLA.</b><p>Çdo qytetar mund ta eskalojë publikisht. Eskalimi mbetet përgjithmonë në blockchain.</p></div>{account ? <button className="danger" disabled={busy} onClick={escalate}>Eskalo publikisht</button> : <span>Lidh MetaMask për ta eskaluar</span>}</div>}
    {item.status === 4 && <div className="detail-ai"><AiCard item={item} canVerify={false} canReassess={false} /></div>}
    <div className="detail-layout"><div className="detail-card">{rows.map(([k,v]) => <div key={k}><span>{k}</span><b className={String(v).startsWith("0x") ? "mono" : ""}>{v}</b></div>)}</div>
      <section className="timeline-card"><h3>Historiku në blockchain</h3><Timeline id={item.id} categories={categories} /></section></div></div>;
}

export default function App() { return <Shell><Routes><Route path="/" element={<Dashboard/>}/><Route path="/new" element={<NewRequest/>}/><Route path="/mine" element={<Mine/>}/><Route path="/municipality" element={<Municipality/>}/><Route path="/contractor" element={<Contractor/>}/><Route path="/request/:id" element={<Detail/>}/></Routes></Shell>; }
