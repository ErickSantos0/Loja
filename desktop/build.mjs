import { build as bundle } from "esbuild";
import { build as viteBuild } from "../node_modules/vite/dist/node/index.js";
import react from "../node_modules/@vitejs/plugin-react/dist/index.js";
import tailwind from "../node_modules/@tailwindcss/postcss/dist/index.mjs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { copyFile, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
const here = path.dirname(fileURLToPath(import.meta.url));
// Also supports npm configurations that disable dependency lifecycle scripts.
execFileSync(
  process.execPath,
  [path.join(here, "node_modules/electron/install.js")],
  { stdio: "inherit" },
);
await mkdir(path.join(here, "dist"), { recursive: true });
await copyFile(
  path.join(here, "assets/icon.ico"),
  path.join(here, "dist/icon.ico"),
);
if (!process.argv.includes("--renderer-only")) await bundle({
  entryPoints: {
    main: path.join(here, "main/main.ts"),
    preload: path.join(here, "main/preload.ts"),
  },
  outdir: path.join(here, "dist"),
  outExtension: { ".js": ".cjs" },
  platform: "node",
  target: "node24",
  format: "cjs",
  bundle: true,
  external: ["electron"],
  sourcemap: false,
});
await viteBuild({
  configFile: false,
  root: path.join(here, "renderer"),
  base: "./",
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(here, "..") },
    dedupe: ["react", "react-dom"],
  },
  css: { postcss: { plugins: [tailwind()] } },
  build: {
    outDir: path.join(here, "dist/renderer"),
    emptyOutDir: true,
    target: "chrome152",
    sourcemap: false,
  },
});
