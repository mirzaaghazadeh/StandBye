#!/usr/bin/env node
// Renders every icon the product ships from one piece of artwork (the mark below), with Electron
// (SVG → PNG) and iconutil. Usage: node scripts/make-icon.mjs   (run from anywhere)
//
//   apps/desktop/build/icon.png   the app icon: inset plate, macOS-style breathing room
//   apps/desktop/build/icon.icns  the same, packed for macOS
//   apps/web/public/favicon.svg   the browser tab: same mark, full-bleed so it survives 16 pixels
//   apps/web/public/apple-touch-icon.png, icon-192.png, icon-512.png  what phones and crawlers want
//
// Every output is committed, so no builder ever runs this: electron-builder derives the Windows .ico
// from icon.png, .icns needs macOS-only tooling, and the site build just copies public/.
// Run it by hand on a Mac after changing the artwork below, and commit the result.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktop = path.join(root, "apps/desktop");
const buildDir = path.join(desktop, "build");
const webPublic = path.join(root, "apps/web/public");
fs.mkdirSync(buildDir, { recursive: true });

// An agent in front, the owner behind. The site header draws the same mark inline (apps/web/src/App.tsx).
const MARK = `<circle cx="21" cy="12" r="4" fill="#FFF6EE" opacity=".7"/>
    <path d="M15 25c1.5-4 4-6 6-6s4.5 2 6 6" fill="#FFF6EE" opacity=".7"/>
    <path d="M11 8.5V6" stroke="#FFF6EE" stroke-width="1.6" stroke-linecap="round"/>
    <circle cx="11" cy="5.4" r="1.1" fill="#FFF6EE"/>
    <rect x="7" y="8.5" width="8" height="7" rx="2" fill="#FFF6EE"/>
    <circle cx="9.3" cy="12" r="1" fill="#B84C26"/>
    <circle cx="12.7" cy="12" r="1" fill="#B84C26"/>
    <path d="M5 25c1.5-4 4-6 6-6s4.5 2 6 6" fill="#FFF6EE"/>`;
const GRADIENT = `<linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#D9683F"/><stop offset="1" stop-color="#A8441F"/></linearGradient>`;

// plate: the rounded square. inset leaves the transparent margin macOS expects around an app icon;
// the web icons fill their box instead, because a favicon has 16 pixels and cannot spend three on margin.
const icon = ({ inset = 0, rx = 224, scale = 30 } = {}) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>${GRADIENT}</defs>
  <rect x="${inset}" y="${inset}" width="${1024 - inset * 2}" height="${1024 - inset * 2}" rx="${rx}" fill="url(#g)"/>
  <g transform="translate(512 512) scale(${scale}) translate(-16 -16.5)">
    ${MARK}
  </g>
</svg>`;

const appIcon = icon({ inset: 100, rx: 186, scale: 25 });
const favicon = icon({ rx: 224, scale: 30 });
// Phones and crawlers mask the corners themselves, and iOS paints black behind any transparency.
const squareIcon = icon({ rx: 0, scale: 30 });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "standbye-icon-"));
const electron = path.join(desktop, "node_modules/.bin/electron" + (process.platform === "win32" ? ".cmd" : ""));

// svg{display:block} kills the inline baseline gap, which otherwise overflows the 1024px window by
// a few pixels and leaves a scrollbar edge down the right and bottom of the capture.
function render(svg, name) {
  const page = path.join(tmp, `${name}.html`);
  const out = path.join(tmp, `${name}.png`);
  fs.writeFileSync(page, `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent;overflow:hidden}svg{display:block}</style>\n${svg}`);
  const mainJs = path.join(tmp, `${name}.cjs`);
  fs.writeFileSync(mainJs, `
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
app.dock && app.dock.hide();
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } });
  await win.loadFile(${JSON.stringify(page)});
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  fs.writeFileSync(${JSON.stringify(out)}, img.toPNG());
  app.quit();
});
`);
  const r = spawnSync(electron, [mainJs], { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ELECTRON_ENABLE_LOGGING: "0" } });
  if (r.status !== 0) { console.error(`electron render failed (${name})`); process.exit(1); }
  return out;
}

const png = render(appIcon, "icon");
fs.copyFileSync(png, path.join(buildDir, "icon.png"));
console.log("wrote", path.join(buildDir, "icon.png"));

fs.writeFileSync(path.join(webPublic, "favicon.svg"), favicon.replace(/\n\s+/g, "") + "\n");
console.log("wrote", path.join(webPublic, "favicon.svg"));

// sips and iconutil only exist on macOS. Elsewhere the committed .icns and web PNGs stand.
if (process.platform !== "darwin") {
  console.log("not macOS: keeping the committed build/icon.icns and apps/web/public PNGs (regenerate them on a Mac)");
  process.exit(0);
}

const square = render(squareIcon, "square");
for (const [size, name] of [[180, "apple-touch-icon.png"], [192, "icon-192.png"], [512, "icon-512.png"]]) {
  const out = path.join(webPublic, name);
  const s = spawnSync("sips", ["-z", String(size), String(size), square, "--out", out], { stdio: "ignore" });
  if (s.status !== 0) { console.error("sips failed for", name); process.exit(1); }
  console.log("wrote", out);
}

const iconset = path.join(tmp, "icon.iconset");
fs.mkdirSync(iconset, { recursive: true });
for (const [size, name] of [[16, "16x16"], [32, "16x16@2x"], [32, "32x32"], [64, "32x32@2x"], [128, "128x128"], [256, "128x128@2x"], [256, "256x256"], [512, "256x256@2x"], [512, "512x512"], [1024, "512x512@2x"]]) {
  spawnSync("sips", ["-z", String(size), String(size), png, "--out", path.join(iconset, `icon_${name}.png`)], { stdio: "ignore" });
}
const ic = spawnSync("iconutil", ["-c", "icns", iconset, "-o", path.join(buildDir, "icon.icns")], { stdio: "inherit" });
if (ic.status !== 0) { console.error("iconutil failed"); process.exit(1); }
console.log("wrote", path.join(buildDir, "icon.icns"));
