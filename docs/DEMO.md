# Skenar video 8-10 minuta

## 0:00-1:00 - Problemi dhe arkitektura

Shpjego tre aktorët, dy smart contracts, ndarjen on-chain/off-chain dhe diagramin nga README. Trego adresat e deployment-it dhe rrjetin Sepolia në MetaMask.

## 1:00-3:00 - Rrjedha 1: qytetari

1. Lidhe MetaMask me llogarinë e qytetarit.
2. Hape “Kërkesë e re”, përshkruaj një problem ndriçimi dhe ngarko një fotografi testuese.
3. Mirato transaksionin dhe hape “Kërkesat e mia”.
4. Trego tx hash, CID dhe statusin “E paraqitur”.

## 3:00-5:30 - Rrjedha 2: komuna

1. Kalo në llogarinë e komunës.
2. Hape panelin “Komuna”, kategorizo kërkesën si “Ndriçim publik”.
3. Autorizo/cakto kontraktuesin.
4. Trego se një adresë e paautorizuar dështon (mund të përdoret një test automatik për të kursyer kohë).

## 5:30-7:30 - Rrjedha 3: kontraktuesi dhe verifikimi

1. Kalo në llogarinë e kontraktuesit dhe hape “Kontraktuesi”.
2. Fillo punën, ngarko fotografinë pas riparimit dhe dorëzo dëshminë.
3. Kalo te komuna, kontrollo CID-në dhe verifiko zgjidhjen.
4. Kalo te qytetari dhe jep vlerësim 5/5.

## 7:30-8:30 - Dashboard dhe SLA

Trego 8 kërkesat e seed-it, 3 kategoritë, 3 statuset finale, statistikat dhe mënyrën si backend-i llogarit kërkesat jashtë SLA-së.

## 8:30-9:30 - Testet dhe siguria

Ekzekuto `npm test`. Veço testet: vetëm komuna cakton kontraktuesin, mbyllja kërkon dëshmi dhe qytetari nuk ndryshon kërkesë të mbyllur. Përmend privatësinë dhe mungesën e secrets në repository.

## 9:30-10:00 - Kontributi individual

Trego Issues/PR-të, skedarët dhe testet e realizuara personalisht. Përfundo me linkun e repository-t dhe adresat Sepolia.
