import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "node:path";

const root = import.meta.dirname;

export default defineConfig({
  root,
  plugins: [svelte()],
  clearScreen: false,
  server: { port: 1430, strictPort: true },
  build: {
    outDir: resolve(root, "dist"),
    emptyOutDir: true,
    target: "es2022",
  },
  test: { include: ["src/**/*.test.ts"] },
});
