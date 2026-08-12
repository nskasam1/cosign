import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
    proxy: {
      // In dev, proxy /api/places/* to Google server-side (no browser Referer sent).
      // In prod, Vercel routes these to api/places/autocomplete.ts + api/places/details.ts.
      "/api/places/autocomplete": {
        target: "https://places.googleapis.com",
        changeOrigin: true,
        rewrite: () => "/v1/places:autocomplete",
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.removeHeader("referer");
            proxyReq.removeHeader("origin");
            const key = process.env.GOOGLE_MAPS_KEY ?? process.env.VITE_GOOGLE_MAPS_KEY;
            if (key) proxyReq.setHeader("X-Goog-Api-Key", key);
          });
        },
      },
      "/api/places/details": {
        target: "https://places.googleapis.com",
        changeOrigin: true,
        rewrite: (p) => {
          const [, qs] = p.split("?");
          const params = new URLSearchParams(qs);
          const placeId = params.get("placeId");
          params.delete("placeId");
          return `/v1/places/${placeId}?${params.toString()}`;
        },
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.removeHeader("referer");
            proxyReq.removeHeader("origin");
            const key = process.env.GOOGLE_MAPS_KEY ?? process.env.VITE_GOOGLE_MAPS_KEY;
            if (key) proxyReq.setHeader("X-Goog-Api-Key", key);
          });
        },
      },
    },
  },
  plugins: [react(), mode === "development" && componentTagger()].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
}));
