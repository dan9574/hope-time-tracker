import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port and must not have its Rust sources watched by Vite.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  build: {
    rollupOptions: {
      // Main window + wallpaper overlay window (rebuild-plan 5).
      input: { main: "index.html", overlay: "overlay.html" },
    },
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/legacy/**"] },
  },
});
