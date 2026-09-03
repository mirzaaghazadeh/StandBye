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

/**
 * The window chrome is per-platform: macOS gets the inset traffic lights over a vibrant sidebar,
 * Windows gets the native control buttons overlaid on our own toolbar, Linux keeps a normal frame
 * (no overlay support there). All three keep the same 38px drag strip at the top of the sidebar.
 */
function windowChrome(): Electron.BrowserWindowConstructorOptions {
  if (process.platform === "darwin") {
    return {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 16, y: 18 },
      vibrancy: "sidebar",
      visualEffectState: "active",
      backgroundColor: "#00000000",
    };
  }
  if (process.platform === "win32") {
    return {
      titleBarStyle: "hidden",
      titleBarOverlay: { color: "#f5f4f1", symbolColor: "#3a3a38", height: 38 },
      backgroundColor: "#f5f4f1",
    };
  }
  return { backgroundColor: "#f5f4f1" };
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 640,
    ...windowChrome(),
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
  // macOS template images are black-on-transparent and the OS inverts them for the menu bar.
  // Windows and Linux do no such thing, so there we draw in the brand orange, which stays legible
  // on both light and dark taskbars.
  const mac = process.platform === "darwin";
  const stroke = mac ? "black" : "#D9683F";
  const size = mac ? 22 : 32;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${stroke}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 20a5 5 0 0 1 6 0"/></svg>`;
  const img = nativeImage.createFromDataURL("data:image/svg+xml;base64," + Buffer.from(svg).toString("base64"));
  if (mac) img.setTemplateImage(true);
  return img;
}

let teamsForTray: { teamId: string; teamName: string; agents: Agent[] }[] = [];

function rebuildTray(): void {
  if (!tray) return;
  const all = teamsForTray.flatMap((t) => t.agents);
  const working = all.filter((a) => a.status === "working").length;
  const needs = all.filter((a) => a.status === "needs_you").length;
  const idle = all.filter((a) => a.status === "idle").length;
  const dot: Record<string, string> = { working: "●", needs_you: "◐", idle: "○", paused: "‖", failed: "✕", over_budget: "$" };
  const menu = Menu.buildFromTemplate([
    { label: `${working} working · ${needs} need you · ${idle} idle`, enabled: false },
    { type: "separator" },
    ...teamsForTray.flatMap((t) => [
      ...(teamsForTray.length > 1 ? [{ label: t.teamName, enabled: false }] : []),
      ...t.agents.map((a) => ({
        label: `${dot[a.status] ?? "○"}  ${a.name} — ${a.statusText || a.status}`,
        click: () => showWindow(`/agent/${a.id}`),
      })),
    ]),
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

let trayTimer: NodeJS.Timeout | null = null;
function refreshTraySoon(): void {
  if (trayTimer) return;
  trayTimer = setTimeout(async () => {
    trayTimer = null;
    try {
      teamsForTray = await host.rpc<typeof teamsForTray>("agents.all");
      status = await host.rpc<SupervisorStatus>("status.get");
      spend = await host.rpc<SpendSummary>("spend.get");
    } catch { /* supervisor gone */ }
    rebuildTray();
  }, 400);
}

host.onEvent((e: PushEvent) => {
  if (e.event === "notify") {
    const teamName = teamsForTray.find((t) => t.teamId === e.teamId)?.teamName;
    const n = new Notification({ title: teamName && teamsForTray.length > 1 ? `${e.data.title} · ${teamName}` : e.data.title, body: e.data.body, silent: false });
    n.on("click", () => showWindow(e.data.questionId ? `/inbox/${e.data.questionId}` : "/inbox"));
    n.show();
  }
  if (["agents.updated", "agent.updated", "supervisor.status", "spend.updated", "teams.updated"].includes(e.event)) refreshTraySoon();
  win?.webContents.send("crew:event", e);
});

// ---------- IPC ----------

ipcMain.handle("crew:rpc", (_e, method: string, params?: unknown) => host.rpc(method, params));
ipcMain.handle("crew:pickFolder", async () => {
  const r = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
  return r.canceled ? null : r.filePaths[0] ?? null;
});
ipcMain.handle("crew:pickFile", async (_e, extensions: string[], label: string) => {
  const r = await dialog.showOpenDialog({ properties: ["openFile"], filters: [{ name: label, extensions }] });
  return r.canceled ? null : r.filePaths[0] ?? null;
});
// Keys are keyed by provider id and never leave this process except to the supervisor, which
// holds them in memory only. Which ids exist is the catalog's business, not this file's.
const present = (keys: Record<string, string>) => Object.fromEntries(Object.entries(keys).map(([k, v]) => [k, Boolean(v)]));
ipcMain.handle("crew:keys.get", () => present(loadKeys()));
ipcMain.handle("crew:keys.set", async (_e, patch: Record<string, string>) => {
  const keys = { ...loadKeys() };
  // An empty value is how the UI removes a key, so it deletes rather than storing "".
  for (const [k, v] of Object.entries(patch)) { if (v) keys[k] = v; else delete keys[k]; }
  saveKeys(keys);
  // Send the removals too, so the supervisor forgets a key in the same call.
  await host.rpc("keys.set", { ...Object.fromEntries(Object.keys(patch).map((k) => [k, ""])), ...keys });
  return present(keys);
});
// A path goes to Finder, a link to the default browser. One handler, because callers pass
// whichever they have and the difference is not theirs to care about.
ipcMain.handle("crew:openPath", async (_e, p: string) => {
  if (/^https?:\/\//i.test(p)) { await shell.openExternal(p); return ""; }
  return shell.openPath(p);
});
ipcMain.handle("crew:dataDir", () => dataDir);

// ---------- lifecycle ----------

app.setName("Standbye");

// Two copies of the app would fight over the tray and the supervisor lock; the second one hands
// its launch to the first instead. (On Windows this is what makes double-clicking the shortcut
// twice reopen the window rather than start a second Standbye.)
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showWindow());
}

void app.whenReady().then(async () => {
  try {
    const script = app.isPackaged
      ? path.join(process.resourcesPath, "supervisor", "dist", "index.js")
      : path.join(path.dirname(require.resolve("@crew/supervisor/package.json")), "dist", "index.js");
    await host.start(script);
    const keys = loadKeys();
    if (Object.keys(keys).length) await host.rpc("keys.set", keys);
    teamsForTray = await host.rpc<typeof teamsForTray>("agents.all");
    status = await host.rpc<SupervisorStatus>("status.get");
    spend = await host.rpc<SpendSummary>("spend.get");
  } catch (e) {
    dialog.showErrorBox("Standbye could not start its supervisor", e instanceof Error ? e.message : String(e));
  }
  tray = new Tray(trayIcon());
  // On Windows and Linux the context menu is right-click only, so left-click opens the window.
  if (process.platform !== "darwin") tray.on("click", () => showWindow());
  rebuildTray();
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

// Closing the window keeps the supervisor (and the agents) running; quitting stops them.
app.on("window-all-closed", () => { /* stay alive in the menu bar */ });
app.on("before-quit", () => host.stop());
