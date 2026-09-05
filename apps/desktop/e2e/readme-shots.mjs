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

// social-preview.png: the 1280x640 card GitHub and every link unfurl shows. Composed on the live
// page so it inherits the site's fonts and palette, around a clone of the real Home window.
{
  const card = await browser.newPage({ viewport: { width: 1280, height: 640 }, deviceScaleFactor: 2 });
  await card.goto(base, { waitUntil: "networkidle" });
  await card.waitForSelector(".hero-demo .mock", { timeout: 30_000 });
  await card.locator(".hero-demo").hover();
  await card.locator(".hero-team").first().click();
  await card.waitForTimeout(900);

  await card.evaluate(() => {
    const mock = document.querySelector(".hero-demo .hero-layer-on .mock") ?? document.querySelector(".hero-demo .mock");
    const window_ = mock.outerHTML;
    const logo = document.querySelector(".brand svg").outerHTML;
    document.body.innerHTML = `
      <div id="card" style="position:relative;width:1280px;height:640px;overflow:hidden;background:linear-gradient(135deg,#faf7f4 0%,#f3ece6 100%);">
        <div style="position:absolute;left:64px;top:88px;width:560px;">
          <div style="display:flex;align-items:center;gap:14px;margin-bottom:34px;">
            <span style="display:flex;width:56px;height:56px;">${logo}</span>
            <span style="font-size:38px;font-weight:600;letter-spacing:-0.02em;color:#1d1c1a;">StandBye</span>
          </div>
          <div style="font-size:46px;line-height:1.12;font-weight:700;letter-spacing:-0.03em;color:#1d1c1a;">
            A standing team of AI agents.<br><span style="color:#c4532b;">Working while you're away.</span>
          </div>
          <div style="margin-top:24px;font-size:19px;line-height:1.5;color:#57534e;max-width:520px;">
            Describe the team you wish you had. They check in on a schedule, keep a board, talk to each
            other, and ask you only when the decision is yours.
          </div>
          <div style="display:flex;gap:10px;margin-top:30px;font-size:14px;color:#57534e;">
            ${["Bring your own key", "macOS · Windows · Linux", "Apache-2.0"].map((t) =>
              `<span style="padding:8px 16px;border:1px solid rgba(0,0,0,0.14);border-radius:999px;background:rgba(255,255,255,0.7);white-space:nowrap;">${t}</span>`).join("")}
          </div>
        </div>
        <div id="win" style="position:absolute;left:700px;top:118px;transform:scale(0.78);transform-origin:top left;">${window_}</div>
      </div>`;
    // Scaled, never resized: at a smaller width the toolbar reflows and its labels collide.
    const w = document.querySelector("#card .mock");
    Object.assign(w.style, { width: "1100px", height: "660px", margin: "0", maxWidth: "none" });
    document.querySelectorAll("#card .hero-layer").forEach((el) => el.removeAttribute("style"));
  });
  await card.waitForTimeout(600);
  const social = path.join(outDir, "social-preview.png");
  await card.locator("#card").screenshot({ path: social });
  // The site serves its own copy — og:image points at standbye.navid.tr/social-preview.png, which is
  // what every link unfurl actually fetches. Both have to move together.
  const sitePublic = path.join(repoRoot, "apps/web/public/social-preview.png");
  if (fs.existsSync(path.dirname(sitePublic))) { fs.copyFileSync(social, sitePublic); console.log("shot social-preview (github + site)"); }
  else console.log("shot social-preview");
  await card.close();
}

await browser.close();
console.log("done");
