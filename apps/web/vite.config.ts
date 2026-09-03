import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// The site reuses the desktop renderer's UI kit (components, icons, tokens) and the
// supervisor's starter team template as-is, straight from their source files.
const desktopUi = resolve(__dirname, "../desktop/src/renderer");
const supervisorSrc = resolve(__dirname, "../../packages/supervisor/src");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@kit": resolve(desktopUi, "ui"),
      "@kit-styles": resolve(desktopUi, "styles.css"),
      "@templates": resolve(supervisorSrc, "templates.ts"),
      "@desktop-pkg": resolve(__dirname, "../desktop/package.json"),
    },
    dedupe: ["react", "react-dom"],
  },
  server: { fs: { allow: [resolve(__dirname, "../..")] }, port: 5174 },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Two pages: / and /download/. nginx serves dist/download/index.html for the second.
    rollupOptions: { input: { index: resolve(__dirname, "index.html"), download: resolve(__dirname, "download/index.html") } },
  },
});
