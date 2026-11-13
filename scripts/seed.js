const hre = require("hardhat");
const deployment = require("../deployments/localhost.json");

async function main() {
  // #0 administrator + operator, #1/#3 qytetare, #2 kontraktues, #4 mbikeqyres (emeruar ne deploy.js)
  const [operator, citizen1, contractor, citizen2, supervisor] = await hre.ethers.getSigners();
  const registry = await hre.ethers.getContractAt("ServiceRegistry", deployment.serviceRegistry);
  const workflow = await hre.ethers.getContractAt("ServiceRequestWorkflow", deployment.serviceRequestWorkflow);
  await (await registry.setContractor(contractor.address, true)).wait();

  const seeds = [
    [citizen1, "bafy-demo-ndricim-1", "Prishtine:42.6629,21.1655"],
    [citizen2, "bafy-demo-uje-2", "Prishtine:42.6590,21.1620"],
    [citizen1, "bafy-demo-rruge-3", "Prishtine:42.6501,21.1710"],
    [citizen2, "bafy-demo-ndricim-4", "Prishtine:42.6710,21.1510"],
    [citizen1, "bafy-demo-uje-5", "Prishtine:42.6800,21.1600"],
    [citizen2, "bafy-demo-rruge-6", "Prishtine:42.6400,21.1800"],
    [citizen1, "bafy-demo-ndricim-7", "Prishtine:42.6750,21.1750"],
    [citizen2, "bafy-demo-uje-8", "Prishtine:42.6550,21.1550"]
  ];
  for (const [citizen, cid, location] of seeds) {
    await (await workflow.connect(citizen).submitRequest(cid, location)).wait();
  }

  // #1: rrjedha e plote - operatori cakton, mbikeqyresi verifikon (katër sy)
  await (await workflow.categorizeRequest(1, 1)).wait();
  await (await workflow.assignContractor(1, contractor.address)).wait();
  await (await workflow.connect(contractor).startWork(1)).wait();
  await (await workflow.connect(contractor).submitWorkProof(1, "bafy-proof-1")).wait();
  await (await workflow.connect(supervisor).verifyResolution(1)).wait();

  // #2 refuzuar, #3 anuluar
  await (await workflow.categorizeRequest(2, 2)).wait();
  await (await workflow.rejectRequest(2, "bafy-reason-2")).wait();
  await (await workflow.connect(citizen1).cancelRequest(3)).wait();

  // #5: verifikuar, pastaj kontestuar nga qytetari
  await (await workflow.categorizeRequest(5, 2)).wait();
  await (await workflow.assignContractor(5, contractor.address)).wait();
  await (await workflow.connect(contractor).startWork(5)).wait();
  await (await workflow.connect(contractor).submitWorkProof(5, "bafy-proof-5")).wait();
  await (await workflow.connect(supervisor).verifyResolution(5)).wait();
  await (await workflow.connect(citizen1).disputeResolution(5, "bafy-dispute-5")).wait();

  // #6 dhe #7: pune e dorezuar me vleresim te AI-se (te dhena demo te nenshkruara nga oracle-i lokal #6),
  // qe mbikeqyresi te demonstroje verifikimin normal (#6) dhe verifikimin kunder AI-se (#7).
  const oracle = (await hre.ethers.getSigners())[6];
  for (const [id, category, verdict, confidence, sameLocation] of [[6, 3, 1, 93, true], [7, 1, 2, 88, false]]) {
    await (await workflow.categorizeRequest(id, category)).wait();
    await (await workflow.assignContractor(id, contractor.address)).wait();
    await (await workflow.connect(contractor).startWork(id)).wait();
    await (await workflow.connect(contractor).submitWorkProof(id, `bafy-proof-${id}`)).wait();
    const reportCid = `seed-demo-ai-report-${id}`;
    const deadline = (await hre.ethers.provider.getBlock("latest")).timestamp + 3600;
    const { chainId } = await hre.ethers.provider.getNetwork();
    const domain = { name: "ServiceRequestWorkflow", version: "3", chainId, verifyingContract: deployment.serviceRequestWorkflow };
    const types = { AiAssessment: [
      { name: "requestId", type: "uint256" }, { name: "proofHash", type: "bytes32" }, { name: "verdict", type: "uint8" },
      { name: "confidence", type: "uint8" }, { name: "sameLocation", type: "bool" }, { name: "reportHash", type: "bytes32" },
      { name: "deadline", type: "uint256" }
    ] };
    const value = { requestId: id, proofHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes(`bafy-proof-${id}`)), verdict, confidence,
      sameLocation, reportHash: hre.ethers.keccak256(hre.ethers.toUtf8Bytes(reportCid)), deadline };
    const signature = await oracle.signTypedData(domain, types, value);
    await (await workflow.submitAiAssessment(id, verdict, confidence, sameLocation, reportCid, deadline, signature)).wait();
  }

  // #4: ujesjelles (SLA 24h) - koha shtyhet 25 ore vetem ne Hardhat lokal, pastaj qytetari e eskalon
  await (await workflow.categorizeRequest(4, 2)).wait();
  if (hre.network.name === "localhost" || hre.network.name === "hardhat") {
    await hre.network.provider.send("evm_increaseTime", [25 * 3600]);
    await hre.network.provider.send("evm_mine", []);
    await (await workflow.connect(citizen2).escalate(4)).wait();
  }

  console.log("U krijuan 8 kerkesa, 3 kategori dhe 3 statuse perfundimtare (Verified, Rejected, Cancelled),");
  console.log("plus nje kerkese te kontestuar (#5), nje te eskaluar per SLA (#4)");
  console.log("dhe dy me vleresim AI: #6 'e zgjidhur', #7 'e pazgjidhur' (presin mbikeqyresin).");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
