require("@nomicfoundation/hardhat-toolbox");
// QTR contract toolchain. Deploy key comes from env only — never committed (spec s2.10).
module.exports = {
  solidity: "0.8.28",
  paths: { sources: "./contracts", tests: "./test-contracts", artifacts: "./artifacts-contracts", cache: "./cache-contracts" },
  networks: {
    baseSepolia: {
      url: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      chainId: 84532,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
    base: {
      url: process.env.BASE_RPC_URL || "https://mainnet.base.org",
      chainId: 8453,
      accounts: process.env.DEPLOYER_PRIVATE_KEY ? [process.env.DEPLOYER_PRIVATE_KEY] : [],
    },
  },
};
