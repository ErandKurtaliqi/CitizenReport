const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  if (!deployer) throw new Error("Nuk u gjet llogari per deploy. Kontrollo .env.");
  console.log("Deploy nga:", deployer.address);
  // Blloku nga i cili backend-i nis indeksimin e eventeve (INDEXER_START_BLOCK).
  const startBlock = await hre.ethers.provider.getBlockNumber();

  const Registry = await hre.ethers.getContractFactory("ServiceRegistry");
  const registry = await Registry.deploy(deployer.address);
  await registry.waitForDeployment();

  const Workflow = await hre.ethers.getContractFactory("ServiceRequestWorkflow");
  const workflow = await Workflow.deploy(await registry.getAddress());
  await workflow.waitForDeployment();

  const categories = [
    ["Ndricim publik", 48],
    ["Ujesjelles", 24],
    ["Demtim rruge", 72]
  ];
  for (const [name, sla] of categories) await (await registry.addCategory(name, sla)).wait();

  // Parimi "katër sy": deployer-i është administrator + operator; mbikëqyrësi duhet të jetë adresë tjetër.
  // Lokalisht merret Hardhat Account #4; në Sepolia vendoset SUPERVISOR_ADDRESS në .env.
  const signers = await hre.ethers.getSigners();
  const supervisor = process.env.SUPERVISOR_ADDRESS || signers[4]?.address;
  await (await registry.setOfficial(deployer.address, 1)).wait();
  if (supervisor && supervisor.toLowerCase() !== deployer.address.toLowerCase()) {
    await (await registry.setOfficial(supervisor, 2)).wait();
  } else {
    console.warn("Kujdes: mungon SUPERVISOR_ADDRESS; verifikimi nuk do te jete i mundur derisa te emerohet nje mbikeqyres.");
  }

  // Versioni 3: oracle-i i AI-se (lokalisht Hardhat Account #6; ne Sepolia AI_ORACLE_ADDRESS).
  const aiOracle = process.env.AI_ORACLE_ADDRESS || signers[6]?.address;
  if (aiOracle) await (await registry.setAiOracle(aiOracle)).wait();
  else console.warn("Kujdes: mungon AI_ORACLE_ADDRESS; vleresimi me AI eshte i caktivizuar.");

  const network = await hre.ethers.provider.getNetwork();
  const deployment = {
    network: hre.network.name,
    chainId: Number(network.chainId),
    deployer: deployer.address,
    serviceRegistry: await registry.getAddress(),
    serviceRequestWorkflow: await workflow.getAddress(),
    startBlock,
    operator: deployer.address,
    supervisor: supervisor && supervisor.toLowerCase() !== deployer.address.toLowerCase() ? supervisor : null,
    aiOracle: aiOracle || null,
    deployedAt: new Date().toISOString()
  };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${hre.network.name}.json`), JSON.stringify(deployment, null, 2));
  console.log(JSON.stringify(deployment, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
