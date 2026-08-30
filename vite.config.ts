import { cloudflare } from "@cloudflare/vite-plugin";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const persistencePath = process.env.OPENQUEST_PERSIST_PATH;

export default defineConfig({
  plugins: [
    react(),
    cloudflare(
      persistencePath ? { persistState: { path: persistencePath } } : {},
    ),
  ],
});
