import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // Plain apostrophes in JSX copy are fine and used throughout the site.
      "react/no-unescaped-entities": "off",
    },
  },
  globalIgnores([".next/**", "node_modules/**", "public/**", "next-env.d.ts", "hardhat.config.js", "scripts/**", "test-contracts/**", "artifacts-contracts/**", "cache-contracts/**"]),
]);
