import { contextBridge, ipcRenderer } from "electron";
import type { PushEvent, UpdateState } from "@crew/shared";

/** This Mac's settings, mirrored from `app-settings.json` in the main process. */
interface AppSettings { keepWorkingWhenClosed: boolean; autoUpdate: boolean }

const api = {
  platform: process.platform,
  rpc: <T = unknown>(method: string, params?: unknown): Promise<T> => ipcRenderer.invoke("crew:rpc", method, params) as Promise<T>,
  onEvent: (cb: (e: PushEvent) => void): (() => void) => {
    const h = (_: unknown, e: PushEvent) => cb(e);
    ipcRenderer.on("crew:event", h);
    return () => ipcRenderer.removeListener("crew:event", h);
  },
  onNavigate: (cb: (route: string) => void): (() => void) => {
    const h = (_: unknown, r: string) => cb(r);
    ipcRenderer.on("crew:navigate", h);
    return () => ipcRenderer.removeListener("crew:navigate", h);
  },
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke("crew:pickFolder") as Promise<string | null>,
  /** This Mac's own settings, e.g. whether the team keeps working after the window is closed. */
  settingsGet: (): Promise<AppSettings> => ipcRenderer.invoke("crew:settings.get") as Promise<AppSettings>,
  settingsSet: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke("crew:settings.set", patch) as Promise<AppSettings>,
  /** Checking for, fetching and installing a newer Standbye. Every call answers with the whole state. */
  updates: {
    get: (): Promise<UpdateState> => ipcRenderer.invoke("crew:updates.get") as Promise<UpdateState>,
    check: (): Promise<UpdateState> => ipcRenderer.invoke("crew:updates.check") as Promise<UpdateState>,
    download: (): Promise<UpdateState> => ipcRenderer.invoke("crew:updates.download") as Promise<UpdateState>,
    /** Swaps in the new version and relaunches, so this call is the last thing this window does. */
    install: (): Promise<boolean> => ipcRenderer.invoke("crew:updates.install") as Promise<boolean>,
    setAuto: (on: boolean): Promise<UpdateState> => ipcRenderer.invoke("crew:updates.setAuto", on) as Promise<UpdateState>,
  },
  onUpdate: (cb: (s: UpdateState) => void): (() => void) => {
    const h = (_: unknown, s: UpdateState) => cb(s);
    ipcRenderer.on("crew:update", h);
    return () => ipcRenderer.removeListener("crew:update", h);
  },
  pickFile: (extensions: string[], label = "File"): Promise<string | null> => ipcRenderer.invoke("crew:pickFile", extensions, label) as Promise<string | null>,
  /** Which providers have a key saved, by provider id. Never the keys themselves. */
  keysGet: (): Promise<Record<string, boolean>> => ipcRenderer.invoke("crew:keys.get") as Promise<Record<string, boolean>>,
  /** Save or, with an empty value, remove keys by provider id. */
  keysSet: (patch: Record<string, string>): Promise<Record<string, boolean>> => ipcRenderer.invoke("crew:keys.set", patch) as Promise<Record<string, boolean>>,
  openPath: (p: string): Promise<string> => ipcRenderer.invoke("crew:openPath", p) as Promise<string>,
  dataDir: (): Promise<string> => ipcRenderer.invoke("crew:dataDir") as Promise<string>,
};

export type CrewApi = typeof api;
contextBridge.exposeInMainWorld("crew", api);
