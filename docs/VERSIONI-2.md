# Versioni 2 - Plani i funksionaliteteve të reja

> **Statusi: i implementuar** (8 nëntor 2026). 57 teste kalojnë. Deploy lokal i bërë; deploy në Sepolia ende jo.

Ky dokument përshkruan katër funksionalitete që e zgjerojnë Projektin 9 (Kërkesa qytetare për shërbime komunale) pa dalë nga tema: secili forcon një pjesë që katalogu e kërkon tashmë - verifikimin e zgjidhjes, kontrollin e rolit të komunës dhe SLA-në.

| # | Funksionaliteti | Problemi real që zgjidh | Preket kontrata | Prioriteti |
|---|---|---|---|---|
| 1 | Parimi "katër sy" (zyrtarë me role) | Një person i vetëm cakton dhe verifikon punën - rrezik konflikti interesi | Po | I lartë |
| 2 | Eskalimi publik i SLA-së | Komuna mund ta injorojë afatin pa pasoja | Po | I lartë |
| 3 | Kontestimi i zgjidhjes nga qytetari | Kërkesa shënohet "e zgjidhur", por problemi mbetet | Po | I lartë |
| 4 | Timeline e auditueshme e kërkesës | Qytetari nuk e sheh kush e bëri çdo hap dhe kur | Jo (vetëm UI + API) | Mesatar |

Pas versionit 2: **9 statuse**, **19 evente**, **4 role** (qytetar, operator, mbikëqyrës, kontraktues) plus administratori i komunës, dhe rreth **50 teste**.

> **Rregull kyç:** kontratat në blockchain nuk ndryshohen pas deploy-it. Funksionalitetet 1-3 duhen implementuar dhe testuar **para** deploy-it në Sepolia. Pas ndryshimeve bëhet deploy i ri lokal dhe përditësohen adresat në `.env`.

---

## Parimi i dizajnit: pa e prishur ABI-në ekzistuese

Struktura `ServiceRequest` dhe funksioni `getRequests()` mbeten **të pandryshuara**. Të dhënat e reja ruhen në një strukturë të veçantë:

```solidity
struct RequestMeta {
    address assignedBy;     // operatori që caktoi kontraktuesin
    address verifiedBy;     // mbikëqyrësi që verifikoi
    uint64  dueAt;          // afati SLA (timestamp)
    bool    escalated;      // a është eskaluar publikisht
    uint8   disputeCount;   // sa herë është kontestuar
    string  disputeCid;     // dëshmia e kontestimit të fundit (IPFS)
}
mapping(uint256 => RequestMeta) private metas;

function getRequestMeta(uint256 id) external view validRequest(id) returns (RequestMeta memory);
```

Përfitimi: frontend-i, backend-i dhe testet ekzistuese vazhdojnë të punojnë. Kodi i ri lexon `getRequestMeta()` vetëm aty ku i duhet.

---

## 1. Parimi "katër sy" - zyrtarë me role

### Ideja
Komuna nuk është më një adresë e vetme. Administratori (pronari i `ServiceRegistry`) emëron zyrtarë me role të ndara:

- **Operatori** - kategorizon, cakton kontraktuesin, refuzon kërkesat dhe rihap kërkesat e kontestuara.
- **Mbikëqyrësi** - verifikon punën dhe vendos për kontestimet.

Rregullat që zbatohen në kontratë:
1. Zyrtari që **caktoi** kontraktuesin **nuk mund** ta verifikojë atë punë (`SelfReview`).
2. Një adresë nuk mund të jetë njëkohësisht zyrtar dhe kontraktues.
3. Vetëm administratori emëron ose heq zyrtarët.

### Ndryshimet në `ServiceRegistry.sol`

```solidity
enum Role { None, Operator, Supervisor }
mapping(address => Role) private officials;

event OfficialRoleChanged(address indexed account, Role role);
error ConflictOfInterest();

function setOfficial(address account, Role role) external onlyOwner {
    if (account == address(0)) revert InvalidAddress();
    if (role != Role.None && contractors[account]) revert ConflictOfInterest();
    officials[account] = role;
    emit OfficialRoleChanged(account, role);
}

function roleOf(address account) external view returns (Role) { return officials[account]; }
```

`setContractor()` merr kontrollin e kundërt: `if (authorized && officials[contractor] != Role.None) revert ConflictOfInterest();`

### Ndryshimet në `ServiceRequestWorkflow.sol`

```solidity
modifier onlyOperator()   { if (registry.roleOf(msg.sender) != Role.Operator)   revert Unauthorized(); _; }
modifier onlySupervisor() { if (registry.roleOf(msg.sender) != Role.Supervisor) revert Unauthorized(); _; }

error SelfReview();
```

| Funksioni | Para | Pas |
|---|---|---|
| `categorizeRequest` | `onlyMunicipality` | `onlyOperator` |
| `assignContractor` | `onlyMunicipality` | `onlyOperator` + ruan `metas[id].assignedBy = msg.sender` |
| `rejectRequest` | `onlyMunicipality` | `onlyOperator` |
| `verifyResolution` | `onlyMunicipality` | `onlySupervisor` + `if (msg.sender == metas[id].assignedBy) revert SelfReview();` + ruan `verifiedBy` |

Kriteri i pranimit "Vetëm komuna cakton kontraktuesin" mbetet i vërtetë: operatori është zyrtar i komunës, i emëruar nga administratori.

### UI
- **Komuna** (`/municipality`): lart shfaqet një badge me rolin e adresës - "Operator" ose "Mbikëqyrës". Operatori sheh vetëm Kategorizo / Cakto / Refuzo; mbikëqyrësi sheh vetëm Verifiko dhe kontestimet.
- **Paneli i administratorit** (seksion i ri në të njëjtën faqe, vetëm për pronarin): fushë adrese + zgjedhje roli (Operator / Mbikëqyrës / Hiq) + butoni **Cakto rolin**.
- **Detajet**: rreshtat e rinj "Caktuar nga" dhe "Verifikuar nga".
- Nëse operatori përpiqet të verifikojë punën që ai vetë e caktoi, UI e çaktivizon butonin me tekstin "Nuk mund ta verifikosh punën që e ke caktuar vetë".

### Llogaritë testuese (Hardhat)
| Account | Roli i ri |
|---|---|
| #0 | Administratori (pronari) + Operator |
| #1, #3 | Qytetarë |
| #2 | Kontraktues |
| #4 | Mbikëqyrës (i ri - duhet importuar në MetaMask) |

### Testet
- Vetëm administratori emëron zyrtarë.
- Qytetari / kontraktuesi nuk mund të kategorizojë ose caktojë.
- Mbikëqyrësi nuk mund të caktojë; operatori nuk mund të verifikojë.
- Operatori nuk mund të verifikojë punën që ka caktuar vetë (`SelfReview`), edhe nëse më vonë i jepet roli mbikëqyrës.
- Kontraktuesi nuk mund të bëhet zyrtar dhe anasjelltas (`ConflictOfInterest`).
- Heqja e rolit (`Role.None`) ia heq menjëherë qasjen.

---

## 2. Eskalimi publik i SLA-së

### Ideja
Sot SLA llogaritet vetëm në backend (Web2) dhe mund të fshihet. Në versionin 2 afati ruhet në blockchain dhe, kur kalon, **kushdo** - qytetari, një gazetar, një OJQ - mund ta shënojë kërkesën si të eskaluar. Eskalimi mbetet përgjithmonë në histori dhe nuk mund të fshihet nga komuna.

### Afatet
- **Faza e pranimit:** kërkesa e paraqitur duhet të kategorizohet brenda `TRIAGE_HOURS = 48` orëve. Kur bëhet `submitRequest`, ruhet `dueAt = createdAt + 48h`.
- **Faza e zgjidhjes:** kur bëhet `categorizeRequest`, ruhet `dueAt = block.timestamp + slaHours(kategoria) * 1 hours`. `ServiceRegistry` ekspozon `slaHoursOf(categoryId)`.

### Kontrata

```solidity
uint64 public constant TRIAGE_HOURS = 48;

event RequestEscalated(uint256 indexed requestId, address indexed escalatedBy, uint64 overdueSeconds);
error NotOverdue();
error AlreadyEscalated();

function escalate(uint256 id) external validRequest(id) {
    ServiceRequest storage item = requests[id];
    RequestMeta storage meta = metas[id];
    if (uint8(item.status) > uint8(Status.WorkSubmitted)) revert ClosedRequest(); // vetëm kërkesat e hapura
    if (block.timestamp <= meta.dueAt) revert NotOverdue();
    if (meta.escalated) revert AlreadyEscalated();
    meta.escalated = true;
    emit RequestEscalated(id, msg.sender, uint64(block.timestamp - meta.dueAt));
}
```

Eskalimi **nuk e ndryshon statusin**: kërkesa vazhdon rrjedhën normale, por mbart shenjën publike "e eskaluar". Kështu nuk prishet asnjë kalim statusi ekzistues.

### Backend
- `/api/dashboard` shton `escalated` (numri i kërkesave të eskaluara) dhe `dueSoon` (kërkesat me më pak se 6 orë të mbetura).
- Llogaritja `overdue` lexon `dueAt` nga kontrata në vend që ta llogarisë vetë, prandaj backend-i dhe blockchain-i nuk mund të japin numra të ndryshëm.

### UI
- **Ballina** dhe **Detajet**: numërues "⏱ 12 orë të mbetura" ose "🔴 Jashtë afatit prej 5 orësh".
- Butoni **Eskalo publikisht** shfaqet vetëm kur afati ka kaluar dhe kërkesa s'është eskaluar. Mund ta përdorë çdo adresë e lidhur me MetaMask.
- **Komuna**: kërkesat e eskaluara renditen të parat, me kornizë të kuqe.
- Metrika e re në Ballinë: "Të eskaluara".

### Testet (me `time.increase` nga `@nomicfoundation/hardhat-network-helpers`)
- Eskalimi para afatit dështon (`NotOverdue`).
- Pas afatit, një adresë e jashtme mund të eskalojë dhe emetohet eventi me sekondat e vonesës.
- Eskalimi i dytë dështon (`AlreadyEscalated`).
- Kërkesa e mbyllur (Verified / Rejected / Cancelled) nuk eskalohet.
- Kategorizimi e zëvendëson afatin 48h me SLA-në e kategorisë.

---

## 3. Kontestimi i zgjidhjes nga qytetari

### Ideja
Pasi mbikëqyrësi e verifikon punën, qytetari ka **7 ditë** kohë ta kontestojë, nëse problemi nuk është zgjidhur realisht. Ai ngarkon foto të re si dëshmi (IPFS) dhe kërkesa kalon në statusin e ri **Disputed**. Pastaj komuna ka dy rrugë:

- **Operatori e rihap** kërkesën: kontraktuesi duhet të punojë përsëri dhe të dorëzojë dëshmi të re.
- **Mbikëqyrësi e hedh poshtë** kontestimin me arsyetim: kërkesa kthehet në Verified. Rregulli "katër sy" vlen edhe këtu - nuk mund ta hedhë poshtë ai që e verifikoi.

Kriteri i pranimit "Qytetari nuk ndryshon kërkesën e mbyllur" mbetet i vërtetë: qytetari nuk e ndryshon kërkesën, por shton vetëm një dëshmi kontestimi brenda afatit, dhe vendimi mbetet te komuna.

### Statusi i ri
```solidity
enum Status { Submitted, Categorized, Assigned, InProgress, WorkSubmitted, Verified, Rejected, Cancelled, Disputed }
```
`Disputed` shtohet **në fund** (indeksi 8), që statuset ekzistuese të ruajnë numrat e tyre.

### Kalimet
```
Verified ──(qytetari, ≤ 7 ditë, pa vlerësim)──▶ Disputed
Disputed ──(operatori: reopenRequest)─────────▶ Assigned    (i njëjti kontraktues, dëshmia e vjetër fshihet)
Disputed ──(mbikëqyrësi: dismissDispute)──────▶ Verified    (me arsyetim në IPFS)
```

### Kontrata

```solidity
uint64 public constant DISPUTE_WINDOW = 7 days;
uint8  public constant MAX_DISPUTES = 2;

event ResolutionDisputed(uint256 indexed requestId, address indexed citizen, string evidenceCid);
event RequestReopened(uint256 indexed requestId, address indexed operator);
event DisputeDismissed(uint256 indexed requestId, address indexed supervisor, string reasonCid);
error DisputeWindowClosed();

function disputeResolution(uint256 id, string calldata evidenceCid) external validRequest(id) {
    ServiceRequest storage item = requests[id];
    RequestMeta storage meta = metas[id];
    if (msg.sender != item.citizen) revert Unauthorized();
    if (item.status != Status.Verified) revert InvalidStatus();
    if (item.rating != 0) revert InvalidStatus();                    // vlerësimi e finalizon zgjidhjen
    if (block.timestamp > item.closedAt + DISPUTE_WINDOW) revert DisputeWindowClosed();
    if (meta.disputeCount >= MAX_DISPUTES) revert InvalidInput();
    if (bytes(evidenceCid).length == 0) revert InvalidInput();
    meta.disputeCount++;
    meta.disputeCid = evidenceCid;
    item.status = Status.Disputed;
    emit ResolutionDisputed(id, msg.sender, evidenceCid);
}

function reopenRequest(uint256 id) external onlyOperator validRequest(id) {
    ServiceRequest storage item = requests[id];
    if (item.status != Status.Disputed) revert InvalidStatus();
    item.status = Status.Assigned;
    item.workProofCid = "";
    item.closedAt = 0;
    metas[id].assignedBy = msg.sender;   // ky operator tani nuk mund ta verifikojë
    emit RequestReopened(id, msg.sender);
}

function dismissDispute(uint256 id, string calldata reasonCid) external onlySupervisor validRequest(id) {
    ServiceRequest storage item = requests[id];
    if (item.status != Status.Disputed) revert InvalidStatus();
    if (msg.sender == metas[id].verifiedBy) revert SelfReview();
    if (bytes(reasonCid).length == 0) revert InvalidInput();
    item.status = Status.Verified;
    emit DisputeDismissed(id, msg.sender, reasonCid);
}
```

Shënim: `dismissDispute` kërkon një mbikëqyrës **tjetër** nga ai që verifikoi. Me vetëm një mbikëqyrës (#4), kontestimi mund vetëm të rihapet. Për të demonstruar edhe hedhjen poshtë, emëro Account #5 si mbikëqyrës të dytë.

Shënim: `closedAt` nuk rivendoset kur kontestimi hidhet poshtë, prandaj afati 7-ditor nuk mund të zgjatet pafundësisht. `MAX_DISPUTES` e kufizon edhe më tej.

### UI
- **Kërkesat e mia**: te kërkesat Verified, pa vlerësim dhe brenda 7 ditëve, shfaqet butoni **Kontesto zgjidhjen**. Ai hap formularin: përshkrim + foto → ngarkohet në IPFS → transaksioni. Pranë butonit tregohet "Mund të kontestosh edhe 5 ditë".
- **Komuna (operator)**: seksioni "Kontestime" me foton e qytetarit pranë dëshmisë së kontraktuesit, dhe butoni **Rihap kërkesën**.
- **Komuna (mbikëqyrës)**: butoni **Hidh poshtë kontestimin** me fushë arsyetimi.
- **Kontraktuesi**: kërkesa e rihapur rishfaqet me badge "Rihapur pas kontestimit".
- Statusi i ri në `STATUSES`: `"E kontestuar"`, me ngjyrë portokalli.

### Testet
- Vetëm qytetari i kërkesës mund të kontestojë.
- Kontestimi pas 7 ditëve dështon (`DisputeWindowClosed`).
- Kontestimi pas vlerësimit dështon.
- Kontestimi pa dëshmi dështon.
- Rihapja e kthen në Assigned dhe fshin dëshminë e vjetër; kontraktuesi duhet të dorëzojë të re.
- Hedhja poshtë nga i njëjti mbikëqyrës që verifikoi dështon (`SelfReview`).
- Kontestimi i tretë dështon (`MAX_DISPUTES`).
- Rrjedha e plotë: verifikim → kontestim → rihapje → punë e re → verifikim nga mbikëqyrës tjetër → vlerësim.

---

## 4. Timeline e auditueshme

### Ideja
Faqja **Detajet** tregon historinë e plotë të kërkesës nga eventet në blockchain: çdo hap, kush e bëri, kur dhe me cilin transaksion. Backend-i e ka gati endpoint-in `GET /api/requests/:id/history` (versioni 1.1).

### Backend
- Indeksuesi (`backend/src/indexer.js`) shton 5 eventet e reja në ABI: `OfficialRoleChanged`, `RequestEscalated`, `ResolutionDisputed`, `RequestReopened`, `DisputeDismissed`.
- Asnjë endpoint i ri nuk nevojitet.

### UI - komponenti `Timeline` në `Detail()`

```
● E paraqitur          08 Nën 2026, 14:05   Qytetari 0x7099…79C8      tx 0xfd2a…5112 ↗
● E kategorizuar       08 Nën 2026, 14:12   Operatori 0xf39F…2266     Ndriçim publik
● Kontraktues i caktuar 08 Nën 2026, 14:15  → 0x3C44…93BC
● 🔴 E eskaluar         10 Nën 2026, 15:00   nga 0x90F7…b906 (5 orë vonesë)
● Puna filloi …
● Dëshmia u dorëzua    CID bafy… (hap foton)
● E verifikuar         nga Mbikëqyrësi 0x15d3…6A65
● ⭐ 5/5
```

- Çdo rresh ka ikonë dhe ngjyrë sipas llojit të eventit (të njëjtat ngjyra si badge-t e statusit).
- Hash-i i transaksionit: në Sepolia (chainId 11155111) bëhet link te `https://sepolia.etherscan.io/tx/...`; lokalisht vetëm kopjohet.
- CID-të e fotove hapen përmes `/api/files/:cid` (fallback lokal) ose një IPFS gateway.
- Pa wallet: faqja punon edhe për vizitorë pa MetaMask, sepse lexon nga API.

---

## Ndryshimet sipas skedarit

| Skedari | Ndryshimi |
|---|---|
| `contracts/ServiceRegistry.sol` | `Role`, `setOfficial`, `roleOf`, `slaHoursOf`, kontrolli `ConflictOfInterest` |
| `contracts/ServiceRequestWorkflow.sol` | `RequestMeta`, `getRequestMeta`, modifikuesit e roleve, `escalate`, `disputeResolution`, `reopenRequest`, `dismissDispute`, statusi `Disputed` |
| `test/ServiceSystem.test.js` | Fixture me operator + mbikëqyrës; testet ekzistuese të verifikimit kalojnë te mbikëqyrësi; ~18 teste të reja |
| `scripts/deploy.js` | Emërimi i Account #0 si Operator dhe i Account #4 si Mbikëqyrës |
| `scripts/seed.js` | Verifikimi nga #4; një kërkesë e eskaluar (`evm_increaseTime`, vetëm localhost); një kërkesë e kontestuar |
| `backend/src/chain.js` | ABI e `getRequestMeta`, `slaHoursOf`; statusi `Disputed` |
| `backend/src/indexer.js` | 5 evente të reja |
| `backend/src/server.js` | `dashboard`: `escalated`, `dueSoon`, `disputed`; `overdue` nga `dueAt` |
| `frontend/src/web3.jsx` | ABI e re, `role` i adresës së lidhur, `STATUSES` + "E kontestuar" |
| `frontend/src/App.jsx` | Paneli i rolit / administratorit, butonat Eskalo / Kontesto / Rihap / Hidh poshtë, `Timeline` |
| `frontend/src/styles.css` | Ngjyra për Disputed / Escalated, stili i timeline |
| `docs/ARKITEKTURA.md`, `docs/SIGURIA.md`, `README.md` | Rolet e reja, kalimet e statuseve, analiza e konfliktit të interesit |

---

## Radha e implementimit

Çdo hap mbyllet me `npm test` të gjelbër para se të kalohet te tjetri.

1. **Katër sy** - kontrata + teste. Është themeli: funksionalitetet 2 dhe 3 përdorin rolet.
2. **Eskalimi SLA** - kontrata + teste.
3. **Kontestimi** - kontrata + teste.
4. Deploy + seed lokal, përditësimi i adresave në `.env`.
5. Backend: ABI, indeksuesi, dashboard.
6. Frontend: rolet, butonat e rinj, timeline.
7. Testi manual end-to-end me 5 llogari MetaMask (shiko skenarin më poshtë).
8. Dokumentimi.
9. **Vetëm pastaj:** deploy në Sepolia.

---

## Skenari i ri i demonstrimit (për videon)

1. **Qytetari (#1)** raporton një llambë të prishur.
2. **Operatori (#0)** e kategorizon dhe cakton kontraktuesin (#2).
3. Kalon afati - **Qytetari 2 (#3)** klikon **Eskalo publikisht**. Timeline tregon eskalimin.
4. **Kontraktuesi (#2)** fillon punën dhe dorëzon dëshminë.
5. **Operatori (#0)** provon të verifikojë → refuzohet: "Nuk mund ta verifikosh punën që e ke caktuar vetë".
6. **Mbikëqyrësi (#4)** verifikon.
7. **Qytetari (#1)** e konteston me foto: "llamba ende nuk punon".
8. **Operatori (#0)** e rihap → kontraktuesi punon përsëri → mbikëqyrësi verifikon → qytetari vlerëson 5/5.
9. Te **Detajet** tregohet timeline e plotë, me çdo hap dhe transaksion.

Në video, eskalimi tregohet më lehtë me një kategori testuese me SLA 1 orë dhe `evm_increaseTime` në Hardhat, ose me një kërkesë të seed-it që është tashmë jashtë afatit.

---

## Rreziqet dhe kufizimet

- **Ndryshimi i ABI-së:** statusi `Disputed` dhe modifikuesit e rinj kërkojnë deploy të ri. Adresat ndryshojnë dhe MetaMask duhet të pastrojë aktivitetin (Settings → Advanced → Clear activity tab data).
- **Koha në blockchain:** `block.timestamp` mund të ndryshojë me disa sekonda - e papërfillshme për afate në orë dhe ditë.
- **Eskalimi kushton gas:** në Sepolia është ETH testues; në prodhim do të financohej nga komuna ose do të bëhej përmes një relayer-i.
- **Administratori mbetet pikë e vetme besimi:** ai emëron zyrtarët. Hapi i ardhshëm do të ishte një multisig (p.sh. Safe) si pronar i `ServiceRegistry` - përmendet në prezantim si punë e ardhshme, nuk implementohet.
- **Privatësia:** dëshmia e kontestimit është foto publike në IPFS. UI duhet ta paralajmërojë qytetarin të mos ngarkojë fytyra ose targa; idealisht të dhënat EXIF/GPS hiqen para ngarkimit.
