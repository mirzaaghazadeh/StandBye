import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, safeStorage, shell, Tray } from "electron";
import path from "node:path";
import fs from "node:fs";
import type { Agent, PushEvent, SupervisorStatus, SpendSummary } from "@crew/shared";
import { SupervisorHost } from "./supervisor.js";

const isDev = !app.isPackaged;
const dataDir = process.env.CREW_DATA_DIR ?? path.join(app.getPath("appData"), "Standbye");
const host = new SupervisorHost(dataDir, (line) => console.log(line));

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let agents: Agent[] = [];
let status: SupervisorStatus | null = null;
let spend: SpendSummary | null = null;

// ---------- keys (encrypted at rest with the OS keychain via safeStorage) ----------

const keysFile = path.join(app.getPath("userData"), "keys.enc");
function loadKeys(): Record<string, string> {
  try {
    if (!fs.existsSync(keysFile)) return {};
    const buf = fs.readFileSync(keysFile);
    const json = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString("utf8");
    return JSON.parse(json) as Record<string, string>;
  } catch { return {}; }
}
function saveKeys(keys: Record<string, string>): void {
  const json = JSON.stringify(keys);
  fs.mkdirSync(path.dirname(keysFile), { recursive: true });
  fs.writeFileSync(keysFile, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(json) : Buffer.from(json), { mode: 0o600 });
}

// ---------- window ----------

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 640,
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 16, y: 18 },
    vibrancy: "sidebar",
    visualEffectState: "active",
    backgroundColor: "#00000000",
    show: false,
    webPreferences: { preload: path.join(__dirname, "../preload/index.js"), sandbox: false, contextIsolation: true },
  });
  win.once("ready-to-show", () => {
    win?.show();
    // Dev aid: CREW_SCREENSHOT=/path/out.png captures the window a few seconds after it opens, then quits if CREW_SCREENSHOT_QUIT=1.
    const shot = process.env.CREW_SCREENSHOT;
    if (shot) {
      setTimeout(async () => {
        try {
          const img = await win?.webContents.capturePage();
          if (img) fs.writeFileSync(shot, img.toPNG());
        } finally {
          if (process.env.CREW_SCREENSHOT_QUIT === "1") app.quit();
        }
      }, Number(process.env.CREW_SCREENSHOT_DELAY ?? 4000));
    }
  });
  win.on("closed", () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: "deny" }; });
  if (isDev && process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(__dirname, "../renderer/index.html"));
}

function showWindow(route?: string): void {
  if (!win) createWindow();
  win?.show();
  win?.focus();
  if (route) win?.webContents.send("crew:navigate", route);
}

// ---------- tray (menu bar item) ----------

function trayIcon(): Electron.NativeImage {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 20a5 5 0 0 1 6 0"/></svg>`;
  const img = nativeImage.createFromDataURL("data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"));
  img.setTemplateImage(true);
  return img;
}

function rebuildTray(): void {
  if (!tray) return;
  const working = agents.filter((a) => a.status === "working").length;
  const needs = agents.filter((a) => a.status === "needs_you").length;
  const idle = agents.filter((a) => a.status === "idle").length;
  const dot: Record<string, string> = { working: "●", needs_you: "◐", idle: "○", paused: "‖", failed: "✕", over_budget: "$" };
  const menu = Menu.buildFromTemplate([
    { label: `${working} working · ${needs} need you · ${idle} idle`, enabled: false },
    { type: "separator" },
    ...agents.map((a) => ({
      label: `${dot[a.status] ?? "○"}  ${a.name} — ${a.statusText || a.status}`,
      click: () => showWindow(`/agent/${a.id}`),
    })),
    { type: "separator" },
    { label: needs ? `${needs} need your answer…` : "Inbox", click: () => showWindow("/inbox") },
    { label: spend ? `Spend today $${spend.todayUsd.toFixed(2)} / $${spend.capUsd}` : "Spend today", enabled: false },
    { type: "separator" },
    status?.pausedAll
      ? { label: "Resume All Agents", click: () => void host.rpc("supervisor.resumeAll") }
      : { label: "Pause All Agents", accelerator: "CmdOrCtrl+Shift+P", click: () => void host.rpc("supervisor.pauseAll") },
    { label: "Open Team Window", accelerator: "CmdOrCtrl+1", click: () => showWindow() },
    { type: "separator" },
    { label: "Quit (agents sleep until you reopen)", role: "quit" },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(`Standbye · ${working} working · ${needs} need you`);
}

// ---------- events from the supervisor ----------

host.onEvent((e: PushEvent) => {
  if (e.event === "agents.updated") agents = e.data;
  if (e.event === "agent.updated") agents = agents.some((a) => a.id === e.data.id) ? agents.map((a) => (a.id === e.data.id ? e.data : a)) : [...agents, e.data];
  if (e.event === "supervisor.status") status = e.data;
  if (e.event === "spend.updated") spend = e.data;
  if (e.event === "notify") {
    const n = new Notification({ title: e.data.title, body: e.data.body, silent: false });
    n.on("click", () => showWindow(e.data.questionId ? `/inbox/${e.data.questionId}` : "/inbox"));
    n.show();
  }
  if (["agents.updated", "agent.updated", "supervisor.status", "spend.updated"].includes(e.event)) rebuildTray();
  win?.webContents.send("crew:event", e);
});

// ---------- IPC ----------

ipcMain.handle("crew:rpc", (_e, method: string, params?: unknown) => host.rpc(method, params));
ipcMain.handle("crew:pickFolder", async () => {
  const r = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  return r.canceled ? null : r.filePaths[0] ?? null;
});
ipcMain.handle("crew:keys.get", () => { const k = loadKeys(); return { anthropic: Boolean(k.anthropic), openrouter: Boolean(k.openrouter) }; });
ipcMain.handle("crew:keys.set", async (_e, patch: Record<string, string>) => {
  const keys = { ...loadKeys() };
  for (const [k, v] of Object.entries(patch)) { if (v) keys[k] = v; else delete keys[k]; }
  saveKeys(keys);
  await host.rpc("keys.set", { anthropic: keys.anthropic ?? "", openrouter: keys.openrouter ?? "" });
  return { anthropic: Boolean(keys.anthropic), openrouter: Boolean(keys.openrouter) };
});
ipcMain.handle("crew:openPath", (_e, p: string) => shell.openPath(p));
ipcMain.handle("crew:dataDir", () => dataDir);

// ---------- lifecycle ----------

app.setName("Standbye");
void app.whenReady().then(async () => {
  try {
    await host.start();
    const keys = loadKeys();
    if (Object.keys(keys).length) await host.rpc("keys.set", keys);
    agents = await host.rpc<Agent[]>("agents.list");
    status = await host.rpc<SupervisorStatus>("status.get");
    spend = await host.rpc<SpendSummary>("spend.get");
  } catch (e) {
    dialog.showErrorBox("Standbye could not start its supervisor", e instanceof Error ? e.message : String(e));
  }
  tray = new Tray(trayIcon());
  rebuildTray();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// Closing the window keeps the supervisor (and the agents) running; quitting stops them.
app.on("window-all-closed", () => { /* stay alive in the menu bar */ });
app.on("before-quit", () => host.stop());
