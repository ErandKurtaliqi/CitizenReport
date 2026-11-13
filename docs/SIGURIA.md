# Analiza e sigurisë dhe privatësisë

| Rreziku | Ndikimi | Kontrolli |
|---|---|---|
| Ndryshim statusi nga aktor i paautorizuar | I lartë | `onlyMunicipality`, kontroll i kontraktuesit dhe qytetarit në kontratë |
| Mbyllje pa punë reale | I lartë | `verifyResolution` kërkon status `WorkSubmitted` dhe CID jo-bosh |
| Kontraktues i rremë | I lartë | Caktimi lejon vetëm adresa të autorizuara në `ServiceRegistry` |
| Ndryshim pas mbylljes | Mesatar | Nuk ka tranzicione dalëse nga statuset finale |
| Dëshmi e ndryshuar | Mesatar | CID/hash ndryshon kur përmbajtja ndryshon |
| Të dhëna personale publike | I lartë | Off-chain; UI kërkon lokacion të përgjithshëm; asnjë emër/telefon on-chain |
| Spam / Sybil nga qytetarët | Mesatar | Për prototip monitorohet nga dashboard; prodhimi kërkon rate limit ose identitet komunal pa PII on-chain |
| Humbje e private key të komunës | I lartë | Wallet institucional multisig rekomandohet; ownership transfer me dy hapa |
| IPFS jo i pin-uar | Mesatar | Kubo me `pin=true`; prodhimi duhet të përdorë pinning të shumëfishtë |
| RPC/API jashtë funksionit | Mesatar | UI mund të lexojë direkt nga blockchain; health endpoint dhe konfigurim i ndashëm |
| Front-running | Ulët | Procesi nuk ka ofertë sekrete ose transferim vlere; statuset kufizohen nga role/state |
| Reentrancy | Ulët | Kontratat nuk transferojnë ETH/tokens dhe bëjnë vetëm thirrje `view` te registry |

## Versioni 2 dhe 3

| Rreziku | Ndikimi | Kontrolli |
|---|---|---|
| Zyrtari verifikon punën që e caktoi vetë | I lartë | `SelfReview`: verifikimi kërkon mbikëqyrës tjetër nga operatori që caktoi |
| Kontraktuesi bëhet zyrtar (ose oracle) | I lartë | `ConflictOfInterest` në `setOfficial`, `setContractor`, `setAiOracle` |
| Komuna injoron afatin | Mesatar | `dueAt` on-chain; kushdo mund ta eskalojë publikisht (`RequestEscalated`) |
| Mbyllje e rreme e kërkesës | I lartë | Qytetari ka 7 ditë për kontestim; maksimum 2 kontestime |
| Vlerësim i falsifikuar i AI-së | I lartë | Nënshkrim EIP-712 i oracle-it; domain me `chainId` dhe adresën e kontratës; `deadline` |
| Vlerësim i vjetër për dëshmi të re | Mesatar | `proofHash` në nënshkrim; pas rihapjes vlerësimi i vjetër nuk vlen |
| Ndryshimi i raportit të AI-së pas nënshkrimit | Mesatar | `reportHash` (keccak256 i CID-së) është pjesë e nënshkrimit |
| AI gabon | Mesatar | AI vetëm këshillon; mbikëqyrësi mund ta kundërshtojë me arsyetim publik (`AiVerdictOverridden`) |
| Prompt injection përmes fotos ose përshkrimit | Mesatar | Instruksion sistemi që i trajton si të dhëna; përgjigje me skemë fikse; validim (çdo gjë e pavlefshme bëhet `inconclusive`) |
| Çelësi i oracle-it vidhet | I lartë | Administratori e ndërron me `setAiOracle`; `address(0)` e çaktivizon AI-në. Prodhimi: disa oracle-a të pavarur (p.sh. 2 nga 3) |
| Privatësia e fotove te Google | Mesatar | Vetëm foto testuese pa fytyra/targa. Sipas kushteve të tier-it falas, të dhënat mund të përdoren nga Google; prodhimi do të përdorte tier me pagesë ose model lokal |
| Abuzim me endpoint-in e rivlerësimit | Ulët | 1 rivlerësim / 30 s për kërkesë; radhë me një vlerësim njëherësh |

## Kufizime të prototipit

- Nuk ka autentikim Web2 për endpoint-et publike; ato nuk shkruajnë në blockchain.
- Fallback lokal nuk është IPFS dhe shërben vetëm për zhvillim.
- Adresa e komunës është një EOA në demo; në prodhim duhet multisig.
- Përmbajtja IPFS është publike nëse nuk enkriptohet. Mos ngarko të dhëna reale personale.

## Checklist para dorëzimit

- `.env`, private keys, seed phrases dhe `GEMINI_API_KEY` nuk janë në Git, video apo prezantim.
- Wallet-i i Sepolia-s nuk përdoret në mainnet dhe ka vetëm test ETH.
- Adresat e kontratave përputhen me Chain ID.
- Testet dhe coverage ekzekutohen pas çdo ndryshimi.
- Fotografitë e demonstrimit nuk përmbajnë fytyra, targa ose adresa private.
