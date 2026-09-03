import { contextBridge, ipcRenderer } from "electron";
import type { PushEvent } from "@crew/shared";

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
  settingsGet: (): Promise<{ keepWorkingWhenClosed: boolean }> => ipcRenderer.invoke("crew:settings.get") as Promise<{ keepWorkingWhenClosed: boolean }>,
  settingsSet: (patch: { keepWorkingWhenClosed?: boolean }): Promise<{ keepWorkingWhenClosed: boolean }> => ipcRenderer.invoke("crew:settings.set", patch) as Promise<{ keepWorkingWhenClosed: boolean }>,
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
