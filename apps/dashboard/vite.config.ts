import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defaultClientConditions, defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    // In dev, workspace packages resolve to their TypeScript source, so edits hot-reload without a build.
    conditions:
      command === "serve"
        ? ["@ofd/source", ...defaultClientConditions]
        : [...defaultClientConditions],
  },
  server: {
    host: process.env.OFD_DEV_HOST ?? "localhost",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: process.env.OFD_API_URL ?? "http://localhost:3000", changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: false },
}));
