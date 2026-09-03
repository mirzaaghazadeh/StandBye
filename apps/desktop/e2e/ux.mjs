#!/usr/bin/env node
// UX pass: walks every screen and empty state, saving a screenshot per step.
// Usage: node e2e/ux.mjs [outDir] [teamName]
import { _electron as electron } from "playwright";
import fs from "node:fs";
import path from "node:path";

const outDir = process.argv[2] ?? path.resolve("e2e/ux-shots");
const teamName = process.argv[3];
fs.mkdirSync(outDir, { recursive: true });
let step = 0;
const shot = async (win, name) => {
  step++;
  const p = path.join(outDir, `${String(step).padStart(2, "0")}-${name}.png`);
  await win.screenshot({ path: p });
  console.log(`shot ${name}`);
};

const app = await electron.launch({ args: ["."], cwd: path.resolve("."), timeout: 60_000 });
const win = await app.firstWindow({ timeout: 60_000 });
win.on("pageerror", (e) => console.error("[renderer error] " + e.message));
win.on("console", (m) => { if (m.type() === "error") console.error("[console] " + m.text().slice(0, 200)); });
await win.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
await win.waitForSelector(".srow", { timeout: 60_000 });
await win.waitForTimeout(1500);

const click = async (sel, opts) => { const l = typeof sel === "string" ? win.locator(sel) : sel; if (await l.count()) { await l.first().click(opts); await win.waitForTimeout(700); return true; } return false; };

try {
  await shot(win, "home");
  await click(".side-ws");
  await shot(win, "switcher");
  if (teamName) { await win.getByText(teamName, { exact: true }).first().click(); await win.waitForTimeout(1500); }
  else await win.keyboard.press("Escape");
  await shot(win, "home-team");

  await click(win.locator(".srow", { hasText: "backend" }));
  await shot(win, "channel");
  await click(win.locator(".srow").filter({ hasText: "Ada" }).first());
  await shot(win, "dm");
  await click(win.locator(".srow", { hasText: "Runs" }));
  await click(win.locator(".tr").first());
  await shot(win, "runs");
  await click(win.locator(".srow", { hasText: "Inbox" }));
  await shot(win, "inbox");
  await click(win.locator(".srow", { hasText: "Home" }));
  await win.locator(".tr").first().dblclick();
  await win.waitForTimeout(700);
  await shot(win, "agent-general");
  for (const tab of ["Soul", "Rules", "Wake-ups", "Memory", "Skills", "Budget"]) {
    if (await click(win.locator(".tab", { hasText: tab }))) await shot(win, "agent-" + tab.toLowerCase().replace(/[^a-z]/g, ""));
  }
  await win.keyboard.press("Escape");
  await win.waitForTimeout(400);
  await click(".sheet-f .btn-primary");
  await click(win.locator(".srow", { hasText: "Settings" }));
  await shot(win, "settings-team");
  await click(win.locator(".seg-i", { hasText: "Providers" }));
  await shot(win, "settings-providers");
  await click(win.locator(".seg-i", { hasText: "Data" }));
  await shot(win, "settings-data");
  await click(".sheet-f .btn-primary");
} catch (e) {
  console.error("FAIL " + (e instanceof Error ? e.message : String(e)));
  await shot(win, "failure").catch(() => undefined);
} finally {
  await app.close();
}
console.log(`\n${step} screenshots in ${outDir}`);
