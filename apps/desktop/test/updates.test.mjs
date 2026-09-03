// Unit tests for the pure half of the auto-updater (apps/desktop/src/main/updateAssets.ts):
// the asset-name guard, picking the file for this machine, and proving a download against a
// digest the release published. These run under plain node — no electron — because the module
// is deliberately free of the `electron` import; the wiring around them lives in updates.ts.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { test } from "node:test";
import {
  checksumSidecarName,
  digestFromGitHubAsset,
  hashFile,
  isSafeAssetName,
  pickAsset,
  sha512ForAsset,
  verifyDownloadedFile,
} from "../src/main/updateAssets.ts";

const asset = (name, size = 1024) => ({ name, url: `https://example.com/${name}`, size });

// ---------- the name guard ----------

test("isSafeAssetName accepts what electron-builder writes", () => {
  for (const name of [
    "StandBye-1.2.3-mac-arm64.zip",
    "StandBye-1.2.3-win-x64-setup.exe",
    "StandBye-1.2.3-linux-x86_64.AppImage",
    "latest-mac.yml",
    "1.2.3.zip",
  ]) {
    assert.equal(isSafeAssetName(name), true, name);
  }
});

test("isSafeAssetName refuses names that are not plain file names", () => {
  for (const name of [
    "../StandBye-1.2.3-mac-arm64.zip", // path traversal
    "dir/StandBye-1.2.3-mac-arm64.zip", // any separator
    "back\\slash.zip", // windows separator
    "StandBye 1.2.3-mac-arm64.zip", // space
    "StandBye-1.2.3-mac-arm64.zip?query=1", // url junk
    "StandBye-1.2.3-mac-arm64.zip'--", // shell-adjacent characters
    ".hidden", // dotfile
    "..dots", // traversal without a separator
    "payload.zip.part", // our own half-downloaded suffix
    `${"a".repeat(130)}.zip`, // longer than any file name we stage
    "", // empty
  ]) {
    assert.equal(isSafeAssetName(name), false, JSON.stringify(name));
  }
});

// ---------- picking the file for this machine ----------

test("pickAsset takes this machine's mac zip and skips the dmg, the other arch, and the sidecar", () => {
  const assets = [
    asset("StandBye-1.2.3-mac-arm64.dmg"), // for humans, not for the updater
    asset("StandBye-1.2.3-mac-x86_64.zip"),
    asset("StandBye-1.2.3-mac-arm64.zip"),
    asset("latest-mac.yml"),
  ];
  const picked = pickAsset(assets, "darwin", "arm64", undefined);
  assert.equal(picked?.name, "StandBye-1.2.3-mac-arm64.zip");
  assert.equal(pickAsset(assets, "darwin", "x64", undefined)?.name, "StandBye-1.2.3-mac-x86_64.zip");
});

test("pickAsset refuses an asset whose name would not be a safe path, even when it otherwise matches", () => {
  const unsafe = [
    asset("../StandBye-1.2.3-mac-arm64.zip"),
    asset("StandBye 1.2.3-mac-arm64.zip"),
    asset("StandBye-1.2.3-mac-arm64.zip.part"),
  ];
  for (const a of unsafe) {
    assert.equal(pickAsset([a], "darwin", "arm64", undefined), null, a.name);
  }
});

test("pickAsset still installs the honest file sitting next to a poisoned one", () => {
  const assets = [
    asset("../StandBye-1.2.3-mac-arm64.zip"),
    asset("StandBye-1.2.3-mac-arm64.zip"),
  ];
  assert.equal(pickAsset(assets, "darwin", "arm64", undefined)?.name, "StandBye-1.2.3-mac-arm64.zip");
});

test("pickAsset on windows takes the setup.exe for the arch", () => {
  const assets = [
    asset("StandBye-1.2.3-win-x64-setup.exe"),
    asset("StandBye-1.2.3-win-arm64-setup.exe"),
    asset("latest.yml"),
  ];
  assert.equal(pickAsset(assets, "win32", "x64", undefined)?.name, "StandBye-1.2.3-win-x64-setup.exe");
  assert.equal(pickAsset(assets, "win32", "arm64", undefined)?.name, "StandBye-1.2.3-win-arm64-setup.exe");
});

test("pickAsset on linux only offers an AppImage when we are running from one", () => {
  const assets = [asset("StandBye-1.2.3-linux-x86_64.AppImage")];
  assert.equal(pickAsset(assets, "linux", "x64", undefined), null, "a deb/rpm install belongs to the package manager");
  const appImagePath = "/usr/local/bin/StandBye.AppImage";
  assert.equal(pickAsset(assets, "linux", "x64", appImagePath)?.name, "StandBye-1.2.3-linux-x86_64.AppImage");
});

test("pickAsset returns null when the release has nothing this machine can install", () => {
  const assets = [asset("StandBye-1.2.3-win-x64-setup.exe"), asset("StandBye-1.2.3-linux-x86_64.AppImage")];
  assert.equal(pickAsset(assets, "darwin", "arm64", undefined), null);
  assert.equal(pickAsset([asset("StandBye-1.2.3-mac-x86_64.zip")], "darwin", "arm64", undefined), null);
});

// ---------- digests: what the release published ----------

test("checksumSidecarName follows the updater that reads it", () => {
  assert.equal(checksumSidecarName("darwin"), "latest-mac.yml");
  assert.equal(checksumSidecarName("win32"), "latest.yml");
  assert.equal(checksumSidecarName("linux"), "latest-linux.yml");
});

test("digestFromGitHubAsset reads GitHub's sha256 and nothing else", () => {
  const hex = "a".repeat(64);
  assert.deepEqual(digestFromGitHubAsset(`sha256:${hex}`), { algo: "sha256", value: hex });
  const mixed = `sha256:${"ABCD".repeat(16)}`;
  assert.deepEqual(digestFromGitHubAsset(mixed), { algo: "sha256", value: "abcd".repeat(16) });
  assert.equal(digestFromGitHubAsset("sha512:0123"), null);
  assert.equal(digestFromGitHubAsset("sha256:not-hex"), null);
  assert.equal(digestFromGitHubAsset("sha256:tooshort"), null);
  assert.equal(digestFromGitHubAsset(undefined), null);
  assert.equal(digestFromGitHubAsset(null), null);
});

// ---------- digests: electron-builder's sidecar ----------

test("sha512ForAsset reads electron-builder's latest-mac.yml", () => {
  const payloadA = "the update payload";
  const payloadB = "the other arch's payload";
  const b64 = (s) => crypto.createHash("sha512").update(s).digest("base64");
  const hex = (s) => crypto.createHash("sha512").update(s).digest("hex");
  const yml = [
    "version: 1.2.3",
    "files:",
    "  - url: StandBye-1.2.3-mac-arm64.zip",
    `    sha512: ${b64(payloadA)}`,
    "    size: 94711234",
    "  - url: StandBye-1.2.3-mac-x86_64.zip",
    `    sha512: ${b64(payloadB)}`,
    "    size: 98304112",
    "path: StandBye-1.2.3-mac-arm64.zip",
    `sha512: ${b64(payloadA)}`,
    "releaseDate: '2026-09-01T10:00:00.000Z'",
  ].join("\n");
  assert.equal(sha512ForAsset(yml, "StandBye-1.2.3-mac-arm64.zip"), hex(payloadA));
  assert.equal(sha512ForAsset(yml, "StandBye-1.2.3-mac-x86_64.zip"), hex(payloadB));
});

test("sha512ForAsset handles a quoted url and falls back to the top-level path/sha512 pair", () => {
  const contents = "the update payload";
  const b64 = crypto.createHash("sha512").update(contents).digest("base64");
  const hex = crypto.createHash("sha512").update(contents).digest("hex");
  const listed = ["files:", '  - url: "StandBye-1.2.3-win-x64-setup.exe"', `    sha512: ${b64}`].join("\n");
  assert.equal(sha512ForAsset(listed, "StandBye-1.2.3-win-x64-setup.exe"), hex);
  const topLevel = ["version: 1.2.3", "path: StandBye-1.2.3-win-x64-setup.exe", `sha512: ${b64}`].join("\n");
  assert.equal(sha512ForAsset(topLevel, "StandBye-1.2.3-win-x64-setup.exe"), hex);
  assert.equal(sha512ForAsset(topLevel, "StandBye-1.2.3-win-arm64-setup.exe"), null);
});

test("sha512ForAsset returns null for files the sidecar does not mention, and for garbage", () => {
  const yml = ["files:", "  - url: StandBye-1.2.3-mac-arm64.zip", `    sha512: ${crypto.createHash("sha512").update("the update payload").digest("base64")}`].join("\n");
  assert.equal(sha512ForAsset(yml, "StandBye-1.2.3-mac-x86_64.zip"), null);
  assert.equal(sha512ForAsset("", "StandBye-1.2.3-mac-arm64.zip"), null);
  assert.equal(sha512ForAsset("not: [a: yaml", "StandBye-1.2.3-mac-arm64.zip"), null);
  assert.equal(sha512ForAsset("files:\n  - url: StandBye-1.2.3-mac-arm64.zip\n    sha512: not-a-digest", "StandBye-1.2.3-mac-arm64.zip"), null);
});

// ---------- proving the download ----------

function withTempFile(basename, contents) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "standbye-updates-test-"));
  const file = path.join(dir, basename);
  fs.writeFileSync(file, contents);
  return { dir, file };
}

test("hashFile matches the digest node computes directly", async () => {
  const { dir, file } = withTempFile("payload.zip", "the update payload");
  try {
    assert.equal(await hashFile(file, "sha256"), crypto.createHash("sha256").update("the update payload").digest("hex"));
    assert.equal(await hashFile(file, "sha512"), crypto.createHash("sha512").update("the update payload").digest("hex"));
    await assert.rejects(() => hashFile(path.join(dir, "missing.zip"), "sha256"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("verifyDownloadedFile passes when the bytes hash to the published digest", async () => {
  const contents = "the update payload";
  const { dir, file } = withTempFile("StandBye-1.2.3-mac-arm64.zip", contents);
  try {
    const expected = { algo: "sha256", value: crypto.createHash("sha256").update(contents).digest("hex") };
    await assert.doesNotReject(() => verifyDownloadedFile(file, { expectedDigest: expected }));
    await assert.doesNotReject(() => verifyDownloadedFile(file, { expectedDigest: null }), "no digest published — the size check was all there was");
    await assert.doesNotReject(() => verifyDownloadedFile(file, {}), "same for an asset with no digest field at all");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("verifyDownloadedFile rejects bytes that do not match the published digest", async () => {
  const { dir, file } = withTempFile("StandBye-1.2.3-mac-arm64.zip", "tampered bytes");
  try {
    const expected = { algo: "sha256", value: crypto.createHash("sha256").update("the real payload").digest("hex") };
    await assert.rejects(() => verifyDownloadedFile(file, { expectedDigest: expected }), /does not match its published sha256 digest/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("verifyDownloadedFile proves the download the way the updater will: sidecar sha512 against bytes on disk", async () => {
  const contents = "the update payload";
  const b64 = crypto.createHash("sha512").update(contents).digest("base64");
  const yml = ["version: 1.2.3", "files:", "  - url: StandBye-1.2.3-mac-arm64.zip", `    sha512: ${b64}`, "    size: 18"].join("\n");
  const value = sha512ForAsset(yml, "StandBye-1.2.3-mac-arm64.zip");
  assert.ok(value, "the sidecar names this file");
  const { dir, file } = withTempFile("StandBye-1.2.3-mac-arm64.zip", contents);
  try {
    await assert.doesNotReject(() => verifyDownloadedFile(file, { expectedDigest: { algo: "sha512", value } }));
    fs.appendFileSync(file, "x");
    await assert.rejects(() => verifyDownloadedFile(file, { expectedDigest: { algo: "sha512", value } }), /sha512/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
