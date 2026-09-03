import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { log } from "./log.js";

/**
 * The owner's answer to "may I stop this Mac sleeping while the team works?", read from the same
 * file the desktop app writes. The daemon outlives the app, so it cannot ask it; the setting is
 * read fresh each time rather than cached, so switching it off is honoured at the end of the
 * current run instead of at the next restart. A missing file means yes: a team that cannot stay
 * awake cannot work unattended, which is the whole point of it.
 */
export function keepAwakeAllowed(globalDir: string): boolean {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(globalDir, "app-settings.json"), "utf8")) as { keepAwake?: unknown };
    return raw.keepAwake !== false;
  } catch {
    return true;
  }
}

/**
 * Keeping the machine awake while there is work in flight.
 *
 * A sleeping Mac is a team that is not working, and the default here is brutal: this one slept a
 * minute after the owner stopped touching it, on battery and on mains alike. Locking the screen
 * and walking away froze every agent mid-run — and because the run was frozen rather than ended,
 * it came back as "Supervisor restarted while this run was active" and the work was thrown away.
 *
 * The desktop app holds its own assertion while it is open, but the supervisor outlives it when
 * the owner has asked the team to keep working, and nothing was holding the machine awake then.
 * So the daemon holds one too, for exactly as long as a run is actually running: `caffeinate -i`
 * blocks idle sleep only, so the display still dims and the screen still locks. Closing the lid
 * still sleeps the machine, as it should.
 */
export class KeepAwake {
  private proc: ChildProcess | null = null;
  private held = 0;

  /** `enabled` is asked every time, so the owner switching it off is honoured without a restart. */
  constructor(private readonly enabled: () => boolean = () => true) {}

  /** Whether this instance is currently holding the machine awake. */
  get holding(): boolean {
    return this.proc !== null;
  }

  /** Called when the number of runs in flight changes. */
  set(active: number): void {
    const want = active > 0 && this.enabled();
    if (active === this.held && want === Boolean(this.proc)) return;
    this.held = active;
    if (want) this.start();
    else this.stop();
  }

  private start(): void {
    if (this.proc || process.platform !== "darwin") return;
    try {
      // -i idle sleep, -m disk sleep. Not -d: the display is the owner's business.
      this.proc = spawn("caffeinate", ["-i", "-m"], { stdio: "ignore", detached: false });
      this.proc.on("exit", () => { this.proc = null; });
      this.proc.on("error", (e) => { log(`could not keep this Mac awake: ${e.message}`); this.proc = null; });
      log("holding this Mac awake while the team works");
    } catch (e) {
      log(`could not keep this Mac awake: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private stop(): void {
    if (!this.proc) return;
    this.proc.kill();
    this.proc = null;
    log("nothing running; letting this Mac sleep again");
  }

  /** On shutdown. Never leave a caffeinate behind holding the machine awake for nobody. */
  dispose(): void {
    this.held = 0;
    this.stop();
  }
}
