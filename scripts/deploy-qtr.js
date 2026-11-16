// Deploy QTR. Usage:
//   DEPLOYER_PRIVATE_KEY=<key> TREASURY_ADDRESS=0x... npx hardhat run scripts/deploy-qtr.js --network baseSepolia
// The deployer key is read from env only and never stored in the repo.
// Owner of the token = TREASURY_ADDRESS (the operator's COINOP treasury), NOT the deployer,
// so a throwaway deployer wallet can be discarded after deployment.
const { ethers } = require("hardhat");
async function main() {
  const treasury = process.env.TREASURY_ADDRESS;
  if (!treasury || !/^0x[0-9a-fA-F]{40}$/.test(treasury)) throw new Error("TREASURY_ADDRESS missing/invalid");
  const QTR = await ethers.getContractFactory("QTR");
  const qtr = await QTR.deploy(treasury);
  await qtr.waitForDeployment();
  console.log("QTR deployed:", await qtr.getAddress(), "owner:", treasury);
}
main().catch((e) => { console.error(e); process.exit(1); });
