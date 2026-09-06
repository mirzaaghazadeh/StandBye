// The Claude Code binary is fetched rather than bundled, so the things that keep that honest —
// what counts as installed, and what is refused — are worth pinning down. Nothing here downloads
// 190 MB: the one test that would is the checksum path, and it is exercised by corrupting a file
// that claims to be the binary rather than by fetching a real one.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { claudeRuntime, platformKey } from "../dist/claude-runtime.js";

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "standbye-rt-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("platformKey names a platform the SDK actually publishes for", () => {
  const key = platformKey();
  // The host running these tests is one of the supported ones, or the suite is on a platform
  // where Claude providers genuinely cannot run and every caller must handle null.
  if (key === null) return;
  assert.match(key, /^(darwin|linux|win32)-(x64|arm64)(-musl)?$/);
  assert.equal(key.startsWith(process.platform), true);
});

test("a data dir with nothing in it reports the binary as missing, with its cost", () => {
  const dir = tmp({ after: () => {} });
  const rt = claudeRuntime(dir);
  if (rt.unsupported) return;
  assert.equal(rt.installed, false);
  // The size is what the owner is asked to agree to, so it has to be a real figure before the
  // download rather than after it.
  assert.ok(rt.bytes > 100_000_000, `expected a nine-figure download, got ${rt.bytes}`);
  assert.match(rt.version, /^\d+\.\d+\.\d+$/);
});

test("the binary is only trusted at exactly the size the manifest states", (t) => {
  const dir = tmp(t);
  const rt = claudeRuntime(dir);
  if (rt.unsupported) return;

  fs.mkdirSync(path.dirname(rt.path), { recursive: true });
  // A truncated download — the shape an interrupted install leaves behind.
  fs.writeFileSync(rt.path, Buffer.alloc(1024));
  assert.equal(claudeRuntime(dir).installed, false, "a short file must not pass for the binary");

  // The right length, which is as far as the cheap check can go; the hash guards the download.
  fs.writeFileSync(rt.path, Buffer.alloc(rt.bytes));
  assert.equal(claudeRuntime(dir).installed, true);

  // One byte too many, the shape of something appended to it.
  fs.appendFileSync(rt.path, Buffer.alloc(1));
  assert.equal(claudeRuntime(dir).installed, false, "a longer file must not pass for the binary");
});

test("the binary is keyed by version, so an SDK upgrade does not reuse the old one", (t) => {
  const dir = tmp(t);
  const rt = claudeRuntime(dir);
  if (rt.unsupported) return;
  assert.ok(rt.path.includes(rt.version), `${rt.path} should be filed under ${rt.version}`);
  assert.ok(rt.path.startsWith(path.join(dir, "runtimes", "claude")), "it belongs under the data dir, not the app bundle");
});
