#!/usr/bin/env node
// Drives the real desktop app with Playwright's Electron support and saves a screenshot per step.
// Usage: node e2e/gui.mjs [outDir] [teamName]   (env CREW_DATA_DIR selects the data folder; with a running
// supervisor advertised there the app attaches to it instead of starting its own)
import { _electron as electron } from "playwright";
import fs from "node:fs";
import path from "node:path";

const outDir = process.argv[2] ?? path.resolve("e2e/shots");
const teamName = process.argv[3];
fs.mkdirSync(outDir, { recursive: true });
const shots = [];
let step = 0;
const shot = async (win, name) => { step++; const p = path.join(outDir, `${String(step).padStart(2, "0")}-${name}.png`); await win.screenshot({ path: p }); shots.push(p); console.log(`shot ${name}`); };
const fail = (msg) => { console.error("FAIL " + msg); process.exitCode = 1; };

const app = await electron.launch({ args: ["."], cwd: path.resolve("."), env: { ...process.env, ELECTRON_ENABLE_LOGGING: "0" }, timeout: 60_000 });
app.process().stdout?.on("data", (d) => { const s = String(d); if (/attached|exited|Error/i.test(s)) process.stdout.write("[app] " + s); });
const win = await app.firstWindow({ timeout: 60_000 });
win.on("pageerror", (e) => { console.error("[renderer error] " + e.message + "\n" + (e.stack ?? "").split("\n").slice(0, 4).join("\n")); process.exitCode = 1; });
win.on("console", (m) => { if (m.type() === "error") console.error("[console.error] " + m.text().slice(0, 300)); });
await win.setViewportSize({ width: 1440, height: 900 }).catch(() => undefined);
await win.waitForSelector(".srow", { timeout: 60_000 });
await win.waitForTimeout(1500);
await shot(win, "home");

try {
  // Team switcher
  await win.click(".side-ws");
  await win.waitForTimeout(400);
  await shot(win, "team-switcher");
  if (teamName) {
    await win.getByText(teamName, { exact: true }).first().click();
    await win.waitForTimeout(1500);
  } else {
    await win.keyboard.press("Escape");
  }
  await shot(win, "home-selected-team");

  // Channel
  const backend = win.locator(".srow", { hasText: "backend" }).first();
  if (await backend.count()) {
    await backend.click();
    await win.waitForTimeout(1200);
    await shot(win, "channel-backend");
    await win.locator(".compose textarea").fill("Nice work team. Rex, when the delete commit lands, run the full suite once more and post the verdict here.");
    await win.locator(".compose textarea").press("Enter");
    await win.waitForTimeout(800);
    await shot(win, "channel-after-send");
  } else fail("no #backend channel");

  // Runs
  await win.locator(".srow", { hasText: "Runs" }).first().click();
  await win.waitForTimeout(1200);
  const firstRun = win.locator(".tr").first();
  if (await firstRun.count()) await firstRun.click();
  await win.waitForTimeout(800);
  await shot(win, "runs");

  // Inbox
  await win.locator(".srow", { hasText: "Inbox" }).first().click();
  await win.waitForTimeout(800);
  await shot(win, "inbox");

  // Board: open, create a card, shoot, delete it again
  await win.locator(".srow", { hasText: "Board" }).first().click();
  await win.waitForTimeout(700);
  await win.locator("button", { hasText: "New task" }).first().click();
  await win.locator(".board-editor input.field").fill("Smoke task");
  await win.locator("button", { hasText: "Add to board" }).click();
  await win.waitForTimeout(700);
  await shot(win, "board");
  await win.locator(".board-card", { hasText: "Smoke task" }).first().click();
  await win.locator("button", { hasText: "Delete" }).click();
  await win.waitForTimeout(700);

  // Agent sheet
  await win.locator(".srow", { hasText: "Home" }).first().click();
  await win.waitForTimeout(600);
  await win.locator(".tr").first().dblclick();
  await win.waitForTimeout(800);
  await shot(win, "agent-sheet-general");
  await win.locator(".tab", { hasText: "Soul" }).click();
  await win.waitForTimeout(500);
  await shot(win, "agent-sheet-soul");
  await win.locator(".tab", { hasText: "Skills" }).click();
  await win.waitForTimeout(500);
  await shot(win, "agent-sheet-skills");
  await win.keyboard.press("Escape").catch(() => undefined);
  await win.locator(".sheet-f .btn-primary").click().catch(() => undefined);
  await win.waitForTimeout(400);

  // Skill library
  await win.locator(".srow", { hasText: "Skills" }).first().click();
  await win.waitForTimeout(900);
  await shot(win, "skills-library");
  const firstSkill = win.locator(".sheet .li").first();
  if (await firstSkill.count()) { await firstSkill.click(); await win.waitForTimeout(600); await shot(win, "skills-detail"); }
  await win.locator(".sheet .ibtn[title^='Add a skill']").first().click();
  await win.waitForTimeout(700);
  await shot(win, "skills-install");
  await win.locator(".seg-i", { hasText: "GitHub" }).click();
  await win.waitForTimeout(400);
  await shot(win, "skills-install-github");
  await win.locator(".seg-i", { hasText: "Write one" }).click();
  await win.waitForTimeout(400);
  await shot(win, "skills-write");
  await win.locator(".sheet-f .btn-primary").click();
  await win.waitForTimeout(400);

  // Inspector model picker
  await win.locator(".insp .pop").first().click();
  await win.waitForTimeout(500);
  await win.keyboard.type("glm");
  await win.waitForTimeout(500);
  await shot(win, "model-picker");
  await win.keyboard.press("Escape");

  // Settings
  await win.locator(".srow", { hasText: "Settings" }).first().click();
  await win.waitForTimeout(800);
  await shot(win, "settings-team");
  await win.locator(".seg-i", { hasText: "Providers" }).click();
  await win.waitForTimeout(500);
  await shot(win, "settings-providers");
  await win.locator(".sheet-f .btn-primary").click();

  // New team wizard (do not create)
  await win.locator(".tb .btn-primary", { hasText: "New Team" }).click();
  await win.waitForTimeout(600);
  await shot(win, "wizard");
  const cont = win.locator(".sheet-f .btn-primary", { hasText: "Continue" });
  if ((await cont.count()) && (await cont.isEnabled())) { await cont.click(); await win.waitForTimeout(500); await shot(win, "wizard-step2"); }
  await win.locator(".sheet-h .ibtn").click().catch(() => undefined);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
  await shot(win, "failure").catch(() => undefined);
} finally {
  await app.close();
}
console.log(`\n${shots.length} screenshots in ${outDir}`);
