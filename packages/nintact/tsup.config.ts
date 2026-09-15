import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/react.tsx", "src/cli.ts"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  target: "node18",
});
