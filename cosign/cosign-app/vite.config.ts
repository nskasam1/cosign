import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

// Dev: the local Cosign server (tsx server/index.ts, port 8787) owns the
// API, SSR share pages, OG images, and seed imagery; Vite proxies those
// paths to it. Prod (`npm run prod`): the server serves dist/ itself and
// no proxy exists. Zero external targets — nothing here may ever point at
// a remote host.
export default defineConfig({
  server: {
    host: "::",
    port: 8080,
    proxy: {
      "/api": "http://localhost:8787",
      "/img": "http://localhost:8787",
      "^/(s|p|og)/.*": "http://localhost:8787",
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
