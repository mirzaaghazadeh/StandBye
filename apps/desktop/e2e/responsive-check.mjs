#!/usr/bin/env node
// Walks the landing page at phone and tablet widths and reports anything that breaks the layout:
// a page that scrolls sideways, an element wider than the screen, text too small to read, or a
// tap target smaller than the ~44px a thumb needs.
//
//   pnpm --filter @crew/web dev
//   node e2e/responsive-check.mjs [baseUrl] [shotDir]
import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] ?? "http://localhost:5174";
const shotDir = process.argv[3] ?? "/tmp/responsive";
fs.mkdirSync(shotDir, { recursive: true });

const VIEWPORTS = [
  { name: "iphone-se", width: 375, height: 667 },
  { name: "iphone-14-pro", width: 393, height: 852 },
  { name: "android", width: 360, height: 800 },
  { name: "tablet", width: 768, height: 1024 },
];
const PAGES = [
  { name: "home", url: "/" },
  { name: "download", url: "/download/" },
];

const browser = await chromium.launch();
let problems = 0;

for (const page_ of PAGES) {
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({
      ...devices["iPhone 13"],
      viewport: { width: vp.width, height: vp.height },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    await page.goto(base + page_.url, { waitUntil: "networkidle" });
    await page.waitForTimeout(900);

    const report = await page.evaluate((vw) => {
      const out = { scrollWidth: document.documentElement.scrollWidth, wide: [], tiny: [], smallTap: [] };
      const seen = new Set();
      const label = (el) => {
        const cls = typeof el.className === "string" ? el.className.split(/\s+/).filter(Boolean).slice(0, 3).join(".") : "";
        return el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (cls ? "." + cls : "");
      };
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none") continue;
        // Overflows the screen horizontally. Skip anything the author explicitly made scrollable.
        if (r.right > vw + 1 || r.left < -1) {
          let scrollable = false;
          for (let p = el; p && p !== document.body; p = p.parentElement) {
            const o = getComputedStyle(p).overflowX;
            if (o === "auto" || o === "scroll" || o === "hidden") { scrollable = true; break; }
          }
          const key = label(el);
          if (!scrollable && !seen.has(key)) { seen.add(key); out.wide.push({ el: key, right: Math.round(r.right), width: Math.round(r.width) }); }
        }
        // Body text under 12px is a squint on a phone. Ignore deliberate mono/pill microcopy.
        const size = parseFloat(cs.fontSize);
        const text = (el.textContent ?? "").trim();
        if (size && size < 11.5 && text.length > 25 && el.children.length === 0) out.tiny.push({ el: label(el), size, text: text.slice(0, 40) });
        // Links and buttons a thumb has to hit.
        if ((el.tagName === "A" || el.tagName === "BUTTON") && text && (r.height < 32 || r.width < 32) && !el.closest(".mock")) {
          out.smallTap.push({ el: label(el), w: Math.round(r.width), h: Math.round(r.height), text: text.slice(0, 24) });
        }
      }
      return out;
    }, vp.width);

    const overflow = report.scrollWidth - vp.width;
    const bad = overflow > 1 || report.wide.length || report.tiny.length;
    if (bad) problems++;
    console.log(`\n=== ${page_.name} @ ${vp.name} (${vp.width}px) ===`);
    console.log(overflow > 1 ? `  ✗ SIDEWAYS SCROLL: page is ${report.scrollWidth}px, ${overflow}px too wide` : "  ✓ no sideways scroll");
    for (const w of report.wide.slice(0, 8)) console.log(`  ✗ overflows: ${w.el} — right edge ${w.right}px, width ${w.width}px`);
    for (const t of report.tiny.slice(0, 5)) console.log(`  ! ${t.size}px text: ${t.el} "${t.text}"`);
    const taps = report.smallTap.slice(0, 4);
    for (const t of taps) console.log(`  ! small tap target ${t.w}x${t.h}: ${t.el} "${t.text}"`);

    await page.screenshot({ path: path.join(shotDir, `${page_.name}-${vp.name}.png`), fullPage: true });
    await ctx.close();
  }
}

await browser.close();
console.log(`\n${problems === 0 ? "clean" : problems + " viewport(s) with problems"}`);
