import crypto from "node:crypto";
import fs from "node:fs";

/**
 * The update checks that need no electron: picking the release asset for this machine, and proving
 * the downloaded bytes are the ones the release published. Kept free of the `electron` import so
 * the tests in apps/desktop/test can run them under plain node (test/updates.test.mjs); updates.ts
 * holds the parts that need the app object and `net`.
 */

/** What the release says the asset's bytes should hash to. GitHub ships sha256 on the asset itself; electron-builder's `latest-*.yml` ships sha512. */
export interface ExpectedDigest { algo: "sha256" | "sha512"; value: string }

export interface ReleaseAsset {
  name: string;
  url: string;
  size: number;
  /** The checksum the release published for these bytes, if any; attached by the updater's check. */
  expectedDigest?: ExpectedDigest | null;
}

// ---------- picking the file for this machine ----------

/**
 * A release asset's name is about to become a path under the updates directory and be handed to
 * the installer. GitHub keeps asset names to simple file names, but a release is just JSON that
 * anyone with write access to the repo (or a stolen maintainer token) can produce — so accept only
 * what electron-builder actually writes (`Standbye-1.2.3-mac-arm64.zip`): no separators, spaces,
 * shell-adjacent characters, or dotfiles.
 */
const SAFE_ASSET_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export function isSafeAssetName(name: string): boolean {
  if (!SAFE_ASSET_NAME.test(name)) return false;
  if (name.includes("..")) return false;
  // Our own download writes `file.part` next to the asset before renaming; never let a release
  // name collide with that, or with anything else we stage next to it.
  if (name.toLowerCase().endsWith(".part")) return false;
  return true;
}

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

  // The name becomes a path and is handed to the installer, so a release whose asset names do not
  // look like electron-builder's output is not a release we download from. An unsafe name loses
  // its candidacy; if nothing safe is left, pickAsset finds nothing and the release page is shown.
  candidates = candidates.filter((a) => isSafeAssetName(a.name));

  // Every artifactName in electron-builder.yml carries the architecture, so a release with nothing
  // matching this one genuinely has no build for this machine. Installing the only file that looks
  // close would put an x86_64 binary on an arm64 box; the release page is the honest answer.
  const tokens = archTokens(arch);
  return candidates.find((a) => tokens.some((t) => lower(a).includes(t))) ?? null;
}

// ---------- what the release published about its bytes ----------

/** electron-builder uploads a sha512 sidecar next to the builds, named after the updater that reads it. */
export function checksumSidecarName(platform: string): string {
  if (platform === "darwin") return "latest-mac.yml";
  if (platform === "win32") return "latest.yml";
  return "latest-linux.yml";
}

/** Accept a sha512 as base64 (electron-builder's format) or hex, and hand back lowercase hex or null. */
function sha512ToHex(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (/^[0-9a-f]{128}$/.test(v)) return v;
  const raw = Buffer.from(value, "base64");
  return raw.length === 64 ? raw.toString("hex") : null;
}

/**
 * GitHub publishes a sha256 digest on every release asset (`digest: "sha256:…"` on the API object).
 * It is the most authoritative checksum we can get — it arrives in the same response that named the
 * asset, with nothing extra to fetch — so the updater prefers it over the electron-builder sidecar.
 */
export function digestFromGitHubAsset(digest: unknown): ExpectedDigest | null {
  if (typeof digest !== "string") return null;
  const m = /^sha256:([0-9a-fA-F]{64})$/.exec(digest);
  const hex = m?.[1];
  return hex ? { algo: "sha256", value: hex.toLowerCase() } : null;
}

/**
 * Read electron-builder's `latest-*.yml` far enough to find the sha512 it published for one asset.
 * The file is flat and machine-written:
 *
 *   version: 1.2.3
 *   files:
 *     - url: Standbye-1.2.3-mac-arm64.zip
 *       sha512: 9aF…==
 *       size: 94711234
 *   path: Standbye-1.2.3-mac-arm64.zip
 *   sha512: 9aF…==
 *
 * so line-scanning is enough; this is not a YAML parser. A file it cannot read yields null and the
 * caller falls back to size-only checking. The result is lowercase hex.
 */
export function sha512ForAsset(yml: string, assetName: string): string | null {
  const unquote = (v: string) =>
    v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) ? v.slice(1, -1) : v;

  const perFile = new Map<string, string>();
  let topLevelPath: string | null = null;
  let topLevelSha512: string | null = null;
  let currentUrl: string | null = null;

  for (const raw of yml.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("-")) {
      // A `files:` entry; everything indented below it belongs to it.
      currentUrl = null;
      const m = /^-\s+url:\s*(.+?)\s*$/.exec(line);
      const url = m?.[1];
      if (url) currentUrl = unquote(url).toLowerCase();
      continue;
    }
    const kv = /^([A-Za-z0-9_-]+):\s*(.*?)\s*$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    const value = unquote(kv[2] ?? "");
    const nested = /^\s/.test(raw);
    if (nested && currentUrl !== null && key === "sha512" && value) {
      const hex = sha512ToHex(value);
      if (hex) perFile.set(currentUrl, hex);
      currentUrl = null;
    } else if (!nested && key === "path") {
      topLevelPath = value;
    } else if (!nested && key === "sha512") {
      topLevelSha512 = value;
    }
  }

  const direct = perFile.get(assetName.toLowerCase());
  if (direct) return direct;
  if (topLevelPath && topLevelSha512 && topLevelPath.toLowerCase() === assetName.toLowerCase()) {
    return sha512ToHex(topLevelSha512);
  }
  return null;
}

// ---------- proving the download ----------

/** Stream the file through the hash so a couple hundred megabytes never sit in memory at once. */
export function hashFile(file: string, algo: "sha256" | "sha512"): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algo);
    const stream = fs.createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function digestsMatch(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/**
 * The last gate before anything unpacks the download: when the release published a digest for this
 * asset, the bytes on disk must hash to it. Without a published digest this is a no-op — the size
 * was already checked during the download — because refusing every release that predates checksums
 * would strand the updater entirely.
 */
export async function verifyDownloadedFile(file: string, asset: { expectedDigest?: ExpectedDigest | null }): Promise<void> {
  const expected = asset.expectedDigest;
  if (!expected) return;
  const actual = await hashFile(file, expected.algo);
  if (!digestsMatch(actual, expected.value)) {
    throw new Error(`The downloaded update does not match its published ${expected.algo} digest, so it will not be installed`);
  }
}
