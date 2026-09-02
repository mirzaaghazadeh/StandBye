#!/usr/bin/env node
// Renders the app icon with Electron (SVG → 1024px PNG) and packs it into build/icon.icns with iconutil.
// Usage: node scripts/make-icon.mjs   (run from anywhere)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const desktop = path.join(root, "apps/desktop");
const buildDir = path.join(desktop, "build");
fs.mkdirSync(buildDir, { recursive: true });

const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}</style>
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#D9683F"/><stop offset="1" stop-color="#A8441F"/></linearGradient>
    <filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000" flood-opacity="0.28"/></filter>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="186" fill="url(#g)" filter="url(#s)"/>
  <g fill="none" stroke="#FFF6EE" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" transform="translate(512 512) scale(21) translate(-12 -12)">
    <circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 20a5 5 0 0 1 6 0"/>
  </g>
  <circle cx="742" cy="282" r="64" fill="#2E9B5F" stroke="#FFF6EE" stroke-width="26"/>
</svg>`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "standbye-icon-"));
const page = path.join(tmp, "icon.html");
fs.writeFileSync(page, html);
const mainJs = path.join(tmp, "main.cjs");
fs.writeFileSync(mainJs, `
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
app.dock && app.dock.hide();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await win.loadFile(${JSON.stringify(page)});
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  fs.writeFileSync(${JSON.stringify(path.join(tmp, "icon.png"))}, img.toPNG());
  app.quit();
});
`);
const electron = path.join(desktop, "node_modules/.bin/electron");
const r = spawnSync(electron, [mainJs], { stdio: "inherit", env: { ...process.env, ELECTRON_ENABLE_LOGGING: "0" } });
if (r.status !== 0) { console.error("electron render failed"); process.exit(1); }

const png = path.join(tmp, "icon.png");
fs.copyFileSync(png, path.join(buildDir, "icon.png"));
const iconset = path.join(tmp, "icon.iconset");
fs.mkdirSync(iconset, { recursive: true });
for (const [size, name] of [[16, "16x16"], [32, "16x16@2x"], [32, "32x32"], [64, "32x32@2x"], [128, "128x128"], [256, "128x128@2x"], [256, "256x256"], [512, "256x256@2x"], [512, "512x512"], [1024, "512x512@2x"]]) {
  spawnSync("sips", ["-z", String(size), String(size), png, "--out", path.join(iconset, `icon_${name}.png`)], { stdio: "ignore" });
}
const ic = spawnSync("iconutil", ["-c", "icns", iconset, "-o", path.join(buildDir, "icon.icns")], { stdio: "inherit" });
if (ic.status !== 0) { console.error("iconutil failed (macOS only)"); process.exit(1); }
console.log("wrote", path.join(buildDir, "icon.icns"));
