/**
 * The Claude Code binary, fetched when it is wanted instead of shipped with the app.
 *
 * `@anthropic-ai/claude-agent-sdk` reaches its harness through one ~190 MB native binary, published
 * as an optional dependency per platform. Bundling it made every download carry Claude whether or
 * not the owner ever picks a Claude provider — and most don't, because a team can run entirely on
 * OpenRouter, a coding plan or a model on this Mac. So the installer ships the SDK (a few MB) and
 * this module goes and gets the binary the first time it is actually needed.
 *
 * It is fetched from the npm registry, which is where the dependency came from when it was bundled:
 * same publisher, same artifact, same version as the SDK sitting next to it. Nothing here trusts the
 * download — the SDK ships `manifest.json` with a SHA-256 and an exact byte count for every
 * platform, and a binary that misses either is deleted rather than run.
 *
 * Where it lands is `<dataDir>/runtimes/claude/<version>/`, beside the other things that are this
 * Mac's business rather than the project's. Keyed by version, so an SDK upgrade fetches the new one
 * and an owner who downgrades still has the old one.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { x as extractTar } from "tar";

export interface ClaudeRuntime {
  /** Version of the native binary this build of the SDK expects. */
  version: string;
  /** Where the binary is, or would be. */
  path: string;
  /** It is there, the right size and (when last checked) the right bytes. */
  installed: boolean;
  /** What the download costs, so the owner is asked before it starts, not during. */
  bytes: number;
  /** Set when this platform has no published binary at all. */
  unsupported: boolean;
}

export interface InstallProgress {
  received: number;
  total: number;
}

interface PlatformEntry {
  binary: string;
  checksum: string;
  size: number;
}

const require_ = createRequire(import.meta.url);

/**
 * The manifest key for this machine.
 *
 * Linux ships twice, glibc and musl, and a musl binary on a glibc host fails to launch with a
 * dynamic-loader error that says nothing useful. Node reports the runtime glibc version in its
 * process report and simply omits the field on musl, which is the cheapest reliable way to tell
 * them apart without shelling out to `ldd`.
 */
export function platformKey(): string | null {
  const arch = process.arch === "arm64" ? "arm64" : process.arch === "x64" ? "x64" : null;
  if (!arch) return null;
  if (process.platform === "darwin") return `darwin-${arch}`;
  if (process.platform === "win32") return `win32-${arch}`;
  if (process.platform === "linux") {
    const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
    const musl = !report?.header?.glibcVersionRuntime;
    return `linux-${arch}${musl ? "-musl" : ""}`;
  }
  return null;
}

/** The installed SDK's own directory. Its `exports` map hides package.json, so resolve the entry. */
function sdkDir(): string {
  return path.dirname(require_.resolve("@anthropic-ai/claude-agent-sdk"));
}

/** The npm version of the SDK, which is also the version of every per-platform binary package. */
function sdkVersion(): string {
  return JSON.parse(fs.readFileSync(path.join(sdkDir(), "package.json"), "utf8")).version as string;
}

/**
 * Cached: `claudeRuntime()` is called on every readiness poll to draw a settings row, and neither
 * the manifest nor the machine changes while the supervisor is up.
 */
let cached: { key: string; entry: PlatformEntry; version: string } | null | undefined;

function manifestEntry(): { key: string; entry: PlatformEntry; version: string } | null {
  if (cached !== undefined) return cached;
  cached = null;
  const key = platformKey();
  if (key) {
    const manifest = JSON.parse(fs.readFileSync(path.join(sdkDir(), "manifest.json"), "utf8")) as {
      version: string;
      platforms: Record<string, PlatformEntry>;
    };
    const entry = manifest.platforms[key];
    if (entry) cached = { key, entry, version: manifest.version };
  }
  return cached;
}

function runtimeDir(globalDir: string, version: string): string {
  return path.join(globalDir, "runtimes", "claude", version);
}

/**
 * What the app knows about the binary without touching the network.
 *
 * The size check is deliberately cheap: it runs on every readiness poll, and a full re-hash of
 * 190 MB to draw a settings row would be absurd. The hash is what guards the download itself, and
 * the file is written atomically, so a wrong-sized file here means an interrupted install, not a
 * tampered one.
 */
export function claudeRuntime(globalDir: string): ClaudeRuntime {
  const found = manifestEntry();
  if (!found) return { version: "", path: "", installed: false, bytes: 0, unsupported: true };
  const { entry, version } = found;
  const binary = path.join(runtimeDir(globalDir, version), entry.binary);
  let installed = false;
  try {
    installed = fs.statSync(binary).size === entry.size;
  } catch {
    /* not there yet */
  }
  return { version, path: binary, installed, bytes: entry.size, unsupported: false };
}

/**
 * Fetch, verify and install the binary. Resolves to its path; safe to call when already installed.
 *
 * Everything happens in a scratch directory next to the destination and is moved into place at the
 * end, so an install killed halfway — the app quit, the network died — leaves nothing that a later
 * `claudeRuntime()` would mistake for a working binary.
 */
export async function installClaudeRuntime(
  globalDir: string,
  onProgress?: (p: InstallProgress) => void,
  signal?: AbortSignal,
): Promise<string> {
  const found = manifestEntry();
  if (!found) throw new Error(`No Claude Code binary is published for ${process.platform}-${process.arch}.`);
  const { key, entry, version } = found;

  const current = claudeRuntime(globalDir);
  if (current.installed) return current.path;

  const dir = runtimeDir(globalDir, version);
  const dest = path.join(dir, entry.binary);
  const scratch = path.join(dir, `.staging-${process.pid}`);
  fs.mkdirSync(scratch, { recursive: true });

  try {
    const pkg = `@anthropic-ai/claude-agent-sdk-${key}`;
    const npmVersion = sdkVersion();
    const url = `https://registry.npmjs.org/${pkg}/-/claude-agent-sdk-${key}-${npmVersion}.tgz`;
    const tarball = path.join(scratch, "package.tgz");

    const res = await fetch(url, { signal });
    if (!res.ok || !res.body) throw new Error(`Could not download the Claude runtime (${res.status} from the npm registry).`);
    // The tarball is compressed, so its length is not entry.size; report against whatever the
    // registry declares and fall back to the uncompressed figure so the bar still means something.
    const total = Number(res.headers.get("content-length")) || entry.size;
    let received = 0;
    const out = fs.createWriteStream(tarball);
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      received += chunk.length;
      out.write(chunk);
      onProgress?.({ received, total });
    }
    await new Promise<void>((resolve, reject) => out.end((e: Error | null) => (e ? reject(e) : resolve())));

    // One file out of the archive: npm lays these out as package/<binary>.
    await extractTar({ file: tarball, cwd: scratch, strip: 1, filter: (p) => p === `package/${entry.binary}` });
    const staged = path.join(scratch, entry.binary);
    if (!fs.existsSync(staged)) throw new Error(`The downloaded package did not contain ${entry.binary}.`);

    // Verify before it is ever executable, and before it is anywhere the runner would look.
    const size = fs.statSync(staged).size;
    if (size !== entry.size) throw new Error(`The Claude runtime is the wrong size (${size} bytes, expected ${entry.size}).`);
    const digest = await sha256(staged);
    if (digest !== entry.checksum) throw new Error(`The Claude runtime failed its checksum. Expected ${entry.checksum}, got ${digest}.`);

    fs.chmodSync(staged, 0o755);
    fs.renameSync(staged, dest);
    return dest;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("data", (c) => hash.update(c));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
