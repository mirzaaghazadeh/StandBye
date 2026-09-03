import { app, net } from "electron";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import path from "node:path";
import type { UpdateRelease, UpdateState } from "@crew/shared";

/**
 * Keeping the app up to date, without a service and without a signing certificate.
 *
 * Standbye is not code-signed yet, which rules out the usual answer (electron-updater's Squirrel.Mac
 * path refuses to install over an unsigned bundle). So this asks GitHub what the latest release is,
 * downloads the one file that matches this machine, unpacks it while the app is still running, and
 * swaps it in from a small detached script once the app has exited. That last step is the only way
 * a process can replace its own bundle: it has to outlive it.
 *
 * The rule everywhere below: never surprise the owner. Downloading happens on its own, installing
 * happens at a moment the owner chose — the Restart button, or the next quit.
 */

/**
 * The repository whose releases are this app's updates. It is spelled out here rather than imported
 * from `@crew/shared`, because the main bundle only ever imports *types* from that package — the
 * packaged app has no resolvable copy of it, so a value import crashes on launch.
 * Keep it the same repo as the `publish:` block in `electron-builder.yml`.
 */
const REPO = "mirzaaghazadeh/StandBye";

/** The releases page, and the API endpoint that skips drafts and pre-releases. */
const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;
const RELEASES_PAGE = `https://github.com/${REPO}/releases/latest`;

/** Long enough that a launch is never competing with the supervisor starting up. */
const FIRST_CHECK_MS = 20_000;
const EVERY_MS = 6 * 60 * 60 * 1000;

// ---------- version comparison ----------

function parseVersion(v: string): { nums: [number, number, number]; pre: string } {
  const s = (v.trim().replace(/^v/i, "").split("+")[0] ?? "").trim();
  const dash = s.indexOf("-");
  const core = dash === -1 ? s : s.slice(0, dash);
  const parts = core.split(".").map((n) => Number.parseInt(n, 10) || 0);
  return { nums: [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0], pre: dash === -1 ? "" : s.slice(dash + 1) };
}

/**
 * Semver order, enough of it for our own tags: -1 if `a` is older than `b`, 0 if the same, 1 if newer.
 * A pre-release is older than the release it leads to (`1.0.0-beta.2` < `1.0.0`), so someone testing
 * a beta is offered the final build rather than told they are already current.
 */
export function compareVersions(a: string, b: string): number {
  const A = parseVersion(a);
  const B = parseVersion(b);
  for (let i = 0; i < 3; i++) {
    const x = A.nums[i] ?? 0;
    const y = B.nums[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  if (A.pre === B.pre) return 0;
  if (!A.pre) return 1;
  if (!B.pre) return -1;
  const ap = A.pre.split(".");
  const bp = B.pre.split(".");
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    const x = ap[i];
    const y = bp[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const nx = /^\d+$/.test(x);
    const ny = /^\d+$/.test(y);
    if (nx && ny) return Number(x) < Number(y) ? -1 : 1;
    if (nx !== ny) return nx ? -1 : 1; // numeric identifiers rank below alphanumeric ones
    return x < y ? -1 : 1;
  }
  return 0;
}

// ---------- picking the file for this machine ----------

export interface ReleaseAsset { name: string; url: string; size: number }

/**
 * electron-builder writes the architecture into the file name, but not always the name Node uses
 * for it: an x64 AppImage is `x86_64`. Match on any of the spellings.
 */
function archTokens(arch: string): string[] {
  if (arch === "x64") return ["x86_64", "x64", "amd64"];
  if (arch === "arm64") return ["arm64", "aarch64"];
  return [arch];
}

/**
 * The one asset this machine can install over itself, or null when the release has nothing it can
 * use. Only formats that can replace an installed app qualify: the macOS `.zip` (the `.dmg` is for
 * humans), the Windows NSIS `setup.exe`, and the Linux AppImage — and the AppImage only when we are
 * actually running from one, since a `.deb` install belongs to the package manager, not to us.
 */
export function pickAsset(
  assets: ReleaseAsset[],
  platform: string = process.platform,
  arch: string = process.arch,
  appImagePath: string | undefined = process.env.APPIMAGE,
): ReleaseAsset | null {
  const lower = (a: ReleaseAsset) => a.name.toLowerCase();
  let candidates: ReleaseAsset[];
  if (platform === "darwin") candidates = assets.filter((a) => lower(a).endsWith(".zip") && lower(a).includes("mac"));
  else if (platform === "win32") candidates = assets.filter((a) => lower(a).endsWith(".exe"));
  else if (platform === "linux" && appImagePath) candidates = assets.filter((a) => lower(a).endsWith(".appimage"));
  else return null;

  // Every artifactName in electron-builder.yml carries the architecture, so a release with nothing
  // matching this one genuinely has no build for this machine. Installing the only file that looks
  // close would put an x86_64 binary on an arm64 box; the release page is the honest answer.
  const tokens = archTokens(arch);
  return candidates.find((a) => tokens.some((t) => lower(a).includes(t))) ?? null;
}

// ---------- the updater ----------

interface GhRelease {
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  published_at?: string;
  assets?: { name?: string; browser_download_url?: string; size?: number }[];
}

export interface UpdaterOptions {
  /** Read the owner's setting fresh every time; they can flip it between checks. */
  isAutoUpdate: () => boolean;
  /** Called on every state change, so the tray and the window always show the same thing. */
  onState: (s: UpdateState) => void;
  /** Tell the owner something once. `onClick` opens the right place in the app. */
  notify: (title: string, body: string, onClick: () => void) => void;
  /** Open a URL in the owner's browser. */
  openExternal: (url: string) => void;
}

export class Updater {
  private state: UpdateState;
  private timer: NodeJS.Timeout | null = null;
  private busy: Promise<void> | null = null;
  /** The unpacked `.app` (macOS) or the downloaded installer (Windows, Linux): what we install. */
  private staged: string | null = null;
  /** The file the last check picked, kept whole so a later Download does not have to guess its URL. */
  private asset: ReleaseAsset | null = null;
  /** Versions we have already interrupted the owner about, so a six-hourly check stays quiet. */
  private readonly told = new Set<string>();
  private stopped = false;
  /**
   * Set once the swap script is running. Restarting to update calls `app.quit()`, which fires
   * `before-quit`, which would otherwise hand the same update to a second script racing the first
   * over the same bundle.
   */
  private handedOff = false;

  constructor(private readonly opts: UpdaterOptions) {
    this.state = {
      stage: "idle",
      current: app.getVersion(),
      release: null,
      progress: 0,
      error: null,
      checkedAt: null,
      canInstall: false,
      autoUpdate: opts.isAutoUpdate(),
    };
  }

  get(): UpdateState {
    return { ...this.state, autoUpdate: this.opts.isAutoUpdate() };
  }

  private set(patch: Partial<UpdateState>): void {
    this.state = { ...this.state, ...patch, autoUpdate: this.opts.isAutoUpdate() };
    this.opts.onState(this.get());
  }

  /** First check shortly after launch, then every six hours for as long as the app is open. */
  start(): void {
    if (this.timer) return;
    // Whatever the last update left in there — an applied installer, an abandoned half-download — is
    // a couple of hundred megabytes nobody will ever open again. A fresh launch has nothing staged.
    try { fs.rmSync(updatesDir(), { recursive: true, force: true }); } catch { /* it can wait for the next download */ }
    setTimeout(() => { if (!this.stopped) void this.check(); }, FIRST_CHECK_MS);
    this.timer = setInterval(() => { if (!this.stopped) void this.check(); }, EVERY_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Ask GitHub what the latest release is. With auto-update on, a newer one is fetched straight
   * away; otherwise the owner is told once and decides.
   */
  async check(manual = false): Promise<UpdateState> {
    if (this.busy) { await this.busy.catch(() => {}); return this.get(); }
    const run = (async () => {
      this.set({ stage: "checking", error: null });
      try {
        const res = await net.fetch(API_LATEST, {
          headers: { Accept: "application/vnd.github+json", "User-Agent": `Standbye/${app.getVersion()}` },
        });
        // A repo whose only releases are drafts has no "latest", and that is not an error worth
        // showing anybody — it just means there is nothing newer to install.
        if (res.status === 404) { this.set({ stage: "idle", release: null, checkedAt: new Date().toISOString() }); return; }
        if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
        const json = (await res.json()) as GhRelease;
        const version = (json.tag_name ?? "").replace(/^v/i, "").trim();
        const checkedAt = new Date().toISOString();
        if (!version || compareVersions(version, this.state.current) <= 0) {
          this.asset = null;
          this.set({ stage: "idle", release: null, checkedAt, progress: 0, canInstall: false });
          return;
        }
        // Already downloaded and waiting for a restart. Without this the six-hourly check would
        // fetch the same two hundred megabytes again for as long as the app stays open.
        if (this.state.stage === "ready" && this.state.release?.version === version) { this.set({ checkedAt }); return; }
        const assets: ReleaseAsset[] = (json.assets ?? [])
          .filter((a): a is { name: string; browser_download_url: string; size?: number } => Boolean(a.name && a.browser_download_url))
          .map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size ?? 0 }));
        const asset = pickAsset(assets);
        this.asset = asset;
        const release: UpdateRelease = {
          version,
          name: json.name?.trim() || `Standbye ${version}`,
          notes: json.body?.trim() ?? "",
          url: json.html_url ?? RELEASES_PAGE,
          publishedAt: json.published_at ?? null,
          assetName: asset?.name ?? null,
          assetSize: asset?.size ?? 0,
        };
        // A dev run is not something we can replace: `out/` is a build directory, not an install.
        const canInstall = app.isPackaged && Boolean(asset);
        this.set({ stage: "available", release, checkedAt, progress: 0, canInstall });
        if (canInstall && asset && this.opts.isAutoUpdate()) {
          await this.fetchAndStage(asset, release);
        } else if (!this.told.has(version)) {
          this.told.add(version);
          this.opts.notify(`Standbye ${version} is available`, canInstall ? "Open Settings → Updates to install it." : "Download it from the releases page.", () => {
            if (!canInstall) this.opts.openExternal(release.url);
          });
        }
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // A machine that is simply offline should not light up the UI in red for ever; the next
        // check overwrites this, and a manual check is the only time anyone is watching.
        this.set({ stage: "error", error: message, checkedAt: new Date().toISOString() });
        if (manual) this.opts.notify("Could not check for updates", message, () => {});
      }
    })();
    this.busy = run;
    try { await run; } finally { this.busy = null; }
    return this.get();
  }

  /** Fetch the release the last check found. Used by the Download button when auto-update is off. */
  async download(): Promise<UpdateState> {
    if (this.busy) { await this.busy.catch(() => {}); return this.get(); }
    const release = this.state.release;
    const asset = this.asset;
    if (!release || !asset || !this.state.canInstall) return this.get();
    const run = this.fetchAndStage(asset, release);
    this.busy = run;
    try { await run; } finally { this.busy = null; }
    return this.get();
  }

  private async fetchAndStage(asset: ReleaseAsset, release: UpdateRelease): Promise<void> {
    const dir = updatesDir();
    try {
      this.set({ stage: "downloading", progress: 0, error: null });
      // Whatever a previous attempt left behind is dead weight; only one update is ever in flight.
      fs.rmSync(dir, { recursive: true, force: true });
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, asset.name);
      await this.downloadTo(asset, file);
      this.staged = await stageForInstall(file, dir);
      this.set({ stage: "ready", progress: 1 });
      if (!this.told.has(`ready:${release.version}`)) {
        this.told.add(`ready:${release.version}`);
        this.opts.notify(`Standbye ${release.version} is ready`, "It installs when you restart, or the next time you quit.", () => {});
      }
    } catch (e) {
      this.staged = null;
      fs.rmSync(dir, { recursive: true, force: true });
      this.set({ stage: "error", progress: 0, error: e instanceof Error ? e.message : String(e) });
    }
  }

  private async downloadTo(asset: ReleaseAsset, file: string): Promise<void> {
    const res = await net.fetch(asset.url, { headers: { "User-Agent": `Standbye/${app.getVersion()}` } });
    if (!res.ok || !res.body) throw new Error(`Download failed: GitHub answered ${res.status}`);
    const total = Number(res.headers.get("content-length") ?? 0) || asset.size;
    const part = `${file}.part`;
    const out = fs.createWriteStream(part);
    const reader = res.body.getReader();
    let got = 0;
    let lastEmit = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        got += value.byteLength;
        if (!out.write(Buffer.from(value.buffer, value.byteOffset, value.byteLength))) await once(out, "drain");
        const now = Date.now();
        if (total > 0 && now - lastEmit > 250) { lastEmit = now; this.set({ progress: Math.min(0.999, got / total) }); }
      }
      await new Promise<void>((resolve, reject) => { out.on("error", reject); out.end(() => resolve()); });
    } catch (e) {
      out.destroy();
      fs.rmSync(part, { force: true });
      throw e;
    }
    // A truncated download that we then unpacked would be a broken app, so check before renaming.
    const written = fs.statSync(part).size;
    if (total > 0 && written !== total) { fs.rmSync(part, { force: true }); throw new Error(`Download was cut short (${written} of ${total} bytes)`); }
    fs.renameSync(part, file);
  }

  /** Swap in the new version and come back up. */
  installAndRestart(): boolean {
    return this.install(true);
  }

  /**
   * Called from `before-quit`. The owner is leaving anyway, so this is the least disruptive moment
   * to apply an update that is already sitting on disk.
   */
  installOnQuit(): void {
    if (this.state.stage === "ready" && this.opts.isAutoUpdate()) this.install(false);
  }

  private install(relaunch: boolean): boolean {
    if (this.handedOff || this.state.stage !== "ready" || !this.staged) return false;
    try {
      this.handedOff = true;
      applyUpdate(this.staged, relaunch);
      // Everything real happens after this process is gone; quitting is what starts it.
      if (relaunch) setTimeout(() => app.quit(), 100);
      return true;
    } catch (e) {
      this.handedOff = false;
      this.set({ stage: "error", error: e instanceof Error ? e.message : String(e) });
      return false;
    }
  }
}

// ---------- unpacking and swapping ----------

/** Where a download and its unpacked contents live. Never holds more than one update at a time. */
function updatesDir(): string {
  return path.join(app.getPath("userData"), "updates");
}

/**
 * Do the slow, failure-prone half while the app is still running and someone can be told about it.
 * Returns the thing `applyUpdate` will move into place.
 */
async function stageForInstall(file: string, dir: string): Promise<string> {
  if (process.platform !== "darwin") return file;
  // `ditto` is the only unarchiver on macOS that keeps the symlinks and permission bits an .app
  // bundle needs; `unzip` quietly produces a bundle that will not launch.
  const to = path.join(dir, "staged");
  fs.mkdirSync(to, { recursive: true });
  await run("/usr/bin/ditto", ["-x", "-k", file, to]);
  const bundle = fs.readdirSync(to).find((n) => n.endsWith(".app"));
  if (!bundle) throw new Error("The downloaded archive did not contain an app bundle");
  return path.join(to, bundle);
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "ignore" });
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited with ${code}`))));
  });
}

/** Where this app is installed, as the thing that would be replaced. */
function installedPath(): string {
  const exe = app.getPath("exe");
  // /Applications/Standbye.app/Contents/MacOS/Standbye -> /Applications/Standbye.app
  if (process.platform === "darwin") return path.dirname(path.dirname(path.dirname(exe)));
  return process.env.APPIMAGE ?? exe;
}

/**
 * Hand the swap to a detached script and get out of the way. A process cannot replace the bundle it
 * is executing from, so the script's first job is to wait for us to exit.
 */
function applyUpdate(staged: string, relaunch: boolean): void {
  if (process.platform === "win32") {
    // electron-builder's NSIS installer closes the running copy itself; `/S` keeps it silent and
    // `--force-run` is how it knows to start the app again afterwards.
    const args = relaunch ? ["/S", "--force-run"] : ["/S"];
    spawn(staged, args, { detached: true, stdio: "ignore" }).unref();
    return;
  }
  const target = installedPath();
  const script = path.join(path.dirname(staged), "apply-update.sh");
  fs.writeFileSync(script, process.platform === "darwin" ? MAC_SCRIPT : APPIMAGE_SCRIPT, { mode: 0o755 });
  spawn("/bin/sh", [script, String(process.pid), staged, target, relaunch ? "1" : "0"], {
    detached: true,
    stdio: "ignore",
  }).unref();
}

/** Wait for the app to exit, then move the new bundle over the old one and put the old one back if that fails. */
const MAC_SCRIPT = `#!/bin/sh
PID="$1"; NEW="$2"; TARGET="$3"; RELAUNCH="$4"
n=0
while kill -0 "$PID" 2>/dev/null && [ "$n" -lt 600 ]; do sleep 0.2; n=$((n+1)); done
rm -rf "$TARGET.old" || exit 1
mv "$TARGET" "$TARGET.old" || exit 1
if ! mv "$NEW" "$TARGET"; then
  mv "$TARGET.old" "$TARGET"
  exit 1
fi
# We downloaded this ourselves, so Gatekeeper's "downloaded from the internet" prompt would be
# asking the owner to re-approve an app they already have open.
/usr/bin/xattr -dr com.apple.quarantine "$TARGET" 2>/dev/null
rm -rf "$TARGET.old"
if [ "$RELAUNCH" = "1" ]; then
  open -n "$TARGET"
fi
exit 0
`;

/** Same idea for a running AppImage: it cannot be overwritten in place until the mount is gone. */
const APPIMAGE_SCRIPT = `#!/bin/sh
PID="$1"; NEW="$2"; TARGET="$3"; RELAUNCH="$4"
n=0
while kill -0 "$PID" 2>/dev/null && [ "$n" -lt 600 ]; do sleep 0.2; n=$((n+1)); done
cp "$TARGET" "$TARGET.old" 2>/dev/null
rm -f "$TARGET" || exit 1
if ! cp "$NEW" "$TARGET"; then
  mv "$TARGET.old" "$TARGET" 2>/dev/null
  exit 1
fi
chmod +x "$TARGET"
rm -f "$TARGET.old"
if [ "$RELAUNCH" = "1" ]; then
  exec "$TARGET"
fi
exit 0
`;
