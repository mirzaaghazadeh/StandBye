import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import WebSocket from "ws";
import type { PushEvent } from "@crew/shared";

/**
 * Owns the supervisor child process and the app's WebSocket connection to it.
 * The renderer never talks to the socket directly; main forwards RPCs and events.
 */
export class SupervisorHost {
  private proc: ChildProcess | null = null;
  private ws: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly listeners = new Set<(e: PushEvent) => void>();
  readonly port: number;
  readonly token: string;
  connected = false;

  constructor(private readonly dataDir: string, private readonly onLog: (line: string) => void) {
    this.port = 47300 + Math.floor(Math.random() * 600);
    this.token = randomBytes(16).toString("hex");
  }

  async start(script: string): Promise<void> {
    const node = findNode();
    if (!node) throw new Error("Could not find a Node.js binary to run the supervisor. Install Node 22+ or set CREW_NODE.");
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.proc = spawn(node, [script, "--data", this.dataDir, "--port", String(this.port), "--token", this.token], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: enrichedPath() },
    });
    this.proc.stdout?.on("data", (d) => this.onLog(String(d).trimEnd()));
    this.proc.stderr?.on("data", (d) => this.onLog(String(d).trimEnd()));
    this.proc.on("exit", (code) => { this.onLog(`[supervisor] exited with ${code}`); this.connected = false; });
    await this.connect();
  }

  private async connect(): Promise<void> {
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        await new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(`ws://127.0.0.1:${this.port}/?token=${this.token}`);
          ws.once("open", () => { this.ws = ws; resolve(); });
          ws.once("error", reject);
          ws.on("message", (raw) => this.onMessage(raw.toString()));
          ws.on("close", () => { this.connected = false; this.ws = null; });
        });
        this.connected = true;
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    throw new Error("Supervisor did not come up");
  }

  private onMessage(raw: string): void {
    let msg: { id?: number; result?: unknown; error?: { message: string }; event?: string; data?: unknown };
    try { msg = JSON.parse(raw); } catch { return; }
    if (typeof msg.id === "number") {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    } else if (msg.event) {
      for (const l of this.listeners) l(msg as PushEvent);
    }
  }

  rpc<T = unknown>(method: string, params?: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) { reject(new Error("Supervisor not connected")); return; }
      const id = this.nextId++;
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  onEvent(l: (e: PushEvent) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  stop(): void {
    this.ws?.close();
    this.proc?.kill("SIGTERM");
  }
}

function enrichedPath(): string {
  const extra = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  const nvm = path.join(os.homedir(), ".nvm", "versions", "node");
  if (fs.existsSync(nvm)) {
    for (const v of fs.readdirSync(nvm).sort().reverse()) extra.unshift(path.join(nvm, v, "bin"));
  }
  return [process.env.PATH ?? "", ...extra].filter(Boolean).join(path.delimiter);
}

function findNode(): string | null {
  if (process.env.CREW_NODE && fs.existsSync(process.env.CREW_NODE)) return process.env.CREW_NODE;
  for (const dir of enrichedPath().split(path.delimiter)) {
    const p = path.join(dir, "node");
    if (fs.existsSync(p)) return p;
  }
  return null;
}
