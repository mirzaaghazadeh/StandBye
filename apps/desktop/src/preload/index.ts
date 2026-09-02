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
  keysGet: (): Promise<{ anthropic: boolean; openrouter: boolean }> => ipcRenderer.invoke("crew:keys.get") as Promise<{ anthropic: boolean; openrouter: boolean }>,
  keysSet: (patch: Record<string, string>): Promise<{ anthropic: boolean; openrouter: boolean }> => ipcRenderer.invoke("crew:keys.set", patch) as Promise<{ anthropic: boolean; openrouter: boolean }>,
  openPath: (p: string): Promise<string> => ipcRenderer.invoke("crew:openPath", p) as Promise<string>,
  dataDir: (): Promise<string> => ipcRenderer.invoke("crew:dataDir") as Promise<string>,
};

export type CrewApi = typeof api;
contextBridge.exposeInMainWorld("crew", api);
