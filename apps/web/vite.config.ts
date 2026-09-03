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
    },
    // Those two files live outside this package, so their own bare imports resolve against
    // apps/desktop / packages/supervisor — folders that have no node_modules in a filtered
    // install like the Docker build. Deduping resolves them from this package instead.
    dedupe: ["react", "react-dom", "@crew/shared", "simple-icons"],
  },
  server: { fs: { allow: [resolve(__dirname, "../..")] }, port: 5174 },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // Three pages: /, /download/ and /docs/openrouter/. nginx's `try_files $uri $uri/` serves each
    // folder's index.html; the input keys only name the chunks, the output path follows the source.
    rollupOptions: {
      input: {
        index: resolve(__dirname, "index.html"),
        download: resolve(__dirname, "download/index.html"),
        docsOpenrouter: resolve(__dirname, "docs/openrouter/index.html"),
      },
    },
  },
});
