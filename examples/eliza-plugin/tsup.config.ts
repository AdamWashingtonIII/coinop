import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "es2022",
  dts: true,
  clean: true,
  sourcemap: true,
  // @elizaos/core is provided by the host runtime at load time.
  external: ["@elizaos/core"],
});
