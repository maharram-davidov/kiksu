import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    // The console talks to the API on another port. Proxying rather than
    // enabling CORS on the API keeps the browser calling a single origin,
    // which means no preflight and no CORS configuration that has to be got
    // right again in production.
    proxy: {
      "/v1": {
        target: process.env.KIKSU_API_URL ?? "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
});
