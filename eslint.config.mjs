import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "node_modules/**", "public/**", "next-env.d.ts", "hardhat.config.js", "scripts/**", "test-contracts/**", "artifacts-contracts/**", "cache-contracts/**"]),
]);
