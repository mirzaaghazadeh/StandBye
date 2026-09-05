#!/usr/bin/env node
// Re-shoots the README assets (.github/assets/*.png and demo.gif) from the site's own mock windows —
// the same components the app is built from, which is how the originals were made. Run the landing
// page first, then this:
//
//   pnpm --filter @crew/web dev            # serves http://localhost:5174
//   node e2e/readme-shots.mjs              # from apps/desktop, where playwright lives
//
// Usage: node e2e/readme-shots.mjs [baseUrl] [outDir]
// The GIF step needs ffmpeg on PATH and is skipped with a note when it is missing.
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const base = process.argv[2] ?? "http://localhost:5174";
const outDir = process.argv[3] ?? path.join(repoRoot, ".github/assets");
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1500 }, deviceScaleFactor: 2 });
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForSelector(".mock", { timeout: 30_000 });

// The site sizes its mock windows for the page (560px); a README image wants the whole window, so
// the inspector and the lower columns are not cut off. Shot-only — the site itself is untouched.
const TALL = ".mock, .hero-stack, .hero-layer .mock { height: 680px !important; }";
await page.addStyleTag({ content: TALL });

// The hero cycles through the example teams on a timer; hovering it pauses, which is what keeps a
// team still long enough to photograph.
const heroTabs = page.locator(".hero-team");
const pinTeam = async (i) => {
  await page.locator(".hero-demo").hover();
  await heroTabs.nth(i).click();
  await page.waitForTimeout(900); // the crossfade is 450ms
};
if (await heroTabs.count()) await pinTeam(0); // the dev team the README describes

const shot = async (selector, name, nth = 0) => {
  const el = page.locator(selector).nth(nth);
  if (!(await el.count())) { console.error(`MISSING ${name} (${selector})`); process.exitCode = 1; return; }
  await el.scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  await el.screenshot({ path: path.join(outDir, `${name}.png`) });
  console.log(`shot ${name}`);
};

// Anchored to the section each mock lives in — the hero renders two Home mocks for its crossfade,
// so a page-wide nth index is not stable.
await shot(".hero-demo .mock", "home");
await shot("#how .mock", "inbox");
await shot("#features .mock", "board", 0);
await shot("#features .mock", "runs", 1);
await shot("#guardrails .mock", "permissions");

// demo.gif: one frame per example team, at the size the page actually renders them.
let ffmpeg = true;
try { execFileSync("ffmpeg", ["-version"], { stdio: "ignore" }); } catch { ffmpeg = false; }
const teams = await heroTabs.count();
if (!ffmpeg) console.log("skip demo.gif — ffmpeg not on PATH");
else if (!teams) console.log("skip demo.gif — no team tabs on the page");
else {
  const frames = fs.mkdtempSync(path.join(os.tmpdir(), "standbye-gif-"));
  for (let i = 0; i < teams; i++) {
    await pinTeam(i);
    await page.locator(".hero-stack").screenshot({ path: path.join(frames, `${String(i).padStart(2, "0")}.png`) });
  }
  console.log(`${teams} frames`);
  // 1.6s a team, matching HERO_INTERVAL_MS. palettegen/paletteuse keeps the flat UI colors clean.
  execFileSync("ffmpeg", [
    "-y", "-framerate", "0.625", "-i", path.join(frames, "%02d.png"),
    "-filter_complex", "[0:v]scale=1092:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=3",
    "-loop", "0", path.join(outDir, "demo.gif"),
  ], { stdio: ["ignore", "ignore", "pipe"] });
  fs.rmSync(frames, { recursive: true, force: true });
  console.log("shot demo.gif");
}

await browser.close();
console.log("done");
