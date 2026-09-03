#!/usr/bin/env node
// Produces apps/desktop/resources/supervisor: the built supervisor with a flat, symlink-free
// node_modules so electron-builder can copy it verbatim into the app bundle.
//
// Runs on macOS, Windows and Linux. better-sqlite3 is native but ships a prebuilt binary for every
// platform inside its own tarball, so nothing is compiled and nothing is downloaded per target —
// pass --platform/--arch only to drop the binaries this build won't use, which is worth ~15 MB an
// installer. Without them the tree is complete for every platform.
//
//   node scripts/deploy-supervisor.mjs                            # keep every prebuild
//   node scripts/deploy-supervisor.mjs --platform linux --arch arm64
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "packages/supervisor");
const shared = path.join(root, "packages/shared");
const out = path.join(root, "apps/desktop/resources/supervisor");

const flag = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const targetPlatform = flag("platform", process.platform);
const targetArch = flag("arch", process.arch);
const crossBuilding = targetPlatform !== process.platform || targetArch !== process.arch;

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(src, "dist"), path.join(out, "dist"), { recursive: true, filter: (p) => !p.endsWith(".map") && !p.endsWith(".d.ts") });
// The skills StandBye ships with, seeded onto the user shelf on first start. They sit beside dist/
// here exactly as they do in the repo, which is how bundledSkillsDir() finds them in both places.
fs.cpSync(path.join(src, "skills"), path.join(out, "skills"), { recursive: true });

const pkg = JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8"));
const deps = { ...pkg.dependencies };
delete deps["@crew/shared"]; // copied in below as real files
fs.writeFileSync(path.join(out, "package.json"), JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: "module", main: "dist/index.js", dependencies: deps }, null, 2));

// npm is npm.cmd on Windows, which needs a shell to resolve. --ignore-scripts keeps npm from
// invoking node-gyp on better-sqlite3, which has a binding.gyp but ships prebuilt binaries.
//
// --os/--cpu matter: @anthropic-ai/claude-agent-sdk picks its ~190 MB native Claude Code binary
// through optionalDependencies keyed on os/cpu, and npm resolves those against the *host* unless
// told otherwise. Without this a mac-x64 build made on an arm64 runner ships the arm64 binary.
const r = spawnSync("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-package-lock", "--no-audit", "--no-fund", "--loglevel=error", `--os=${targetPlatform}`, `--cpu=${targetArch}`], {
  cwd: out,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, COREPACK_ENABLE_STRICT: "0", npm_config_workspaces: "false" },
});
if (r.status !== 0) { console.error("npm install failed"); process.exit(1); }

// The Claude Agent SDK ships its ~200 MB native Claude Code binary as one optional dependency per
// platform. npm's --os/--cpu only *filter* those, they never install a foreign one, so the target's
// variant has to be asked for by name with --force (which skips the os/cpu check). Then drop every
// other variant, including the host one npm keeps re-adding.
const anthropicDir = path.join(out, "node_modules/@anthropic-ai");
const sdkPkg = path.join(anthropicDir, "claude-agent-sdk/package.json");
if (fs.existsSync(sdkPkg)) {
  const sdkVersion = JSON.parse(fs.readFileSync(sdkPkg, "utf8")).version;
  const want = `claude-agent-sdk-${targetPlatform}-${targetArch}`;
  const f = spawnSync("npm", ["install", `@anthropic-ai/${want}@${sdkVersion}`, "--force", "--ignore-scripts", "--no-save", "--no-package-lock", "--no-audit", "--no-fund", "--loglevel=error"], {
    cwd: out,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, COREPACK_ENABLE_STRICT: "0", npm_config_workspaces: "false" },
  });
  if (f.status !== 0) { console.error(`could not install @anthropic-ai/${want}@${sdkVersion}`); process.exit(1); }
  for (const d of fs.readdirSync(anthropicDir)) {
    if (d.startsWith("claude-agent-sdk-") && d !== want) fs.rmSync(path.join(anthropicDir, d), { recursive: true, force: true });
  }
  if (!fs.existsSync(path.join(anthropicDir, want))) { console.error(`@anthropic-ai/${want} did not land`); process.exit(1); }
  console.log(`kept claude binary: ${want}@${sdkVersion}`);
}

const sharedOut = path.join(out, "node_modules/@crew/shared");
fs.mkdirSync(sharedOut, { recursive: true });
fs.cpSync(path.join(shared, "dist"), path.join(sharedOut, "dist"), { recursive: true, filter: (p) => !p.endsWith(".map") });
fs.copyFileSync(path.join(shared, "package.json"), path.join(sharedOut, "package.json"));

// Keep only the prebuilt binaries this target can load. node-gyp-build picks by
// `${platform}-${arch}.node`, with a musl variant on Linux; the rest are dead weight.
const prebuilds = path.join(out, "node_modules/better-sqlite3/prebuilds");
if (fs.existsSync(prebuilds)) {
  const keep = new Set([`${targetPlatform}-${targetArch}.node`]);
  if (targetPlatform === "linux") keep.add(`linuxmusl-${targetArch}.node`);
  const have = fs.readdirSync(prebuilds);
  if (![...keep].some((k) => have.includes(k))) {
    console.error(`no prebuilt better-sqlite3 for ${targetPlatform}-${targetArch}; have: ${have.join(", ")}`);
    process.exit(1);
  }
  for (const f of have) if (!keep.has(f)) fs.rmSync(path.join(prebuilds, f), { force: true });
  console.log(`kept prebuilds: ${fs.readdirSync(prebuilds).join(", ")}`);
}

// Prove the tree resolves before packaging. A tree pruned for another target can't load here.
if (crossBuilding) {
  console.log(`supervisor tree built for ${targetPlatform}-${targetArch} (not loadable on this host)`);
} else {
  const t = spawnSync(process.execPath, ["-e", "import('./dist/crew.js').then(()=>console.log('supervisor tree ok')).catch(e=>{console.error(e.message);process.exit(1)})"], { cwd: out, stdio: "inherit" });
  if (t.status !== 0) process.exit(1);
}

fs.rmSync(path.join(out, "node_modules/.bin"), { recursive: true, force: true }); // only symlinks live there
const links = [];
for (const entry of fs.readdirSync(path.join(out, "node_modules"), { recursive: true, withFileTypes: true })) {
  if (entry.isSymbolicLink()) links.push(path.join(entry.parentPath ?? entry.path, entry.name));
}
if (links.length) { console.error("symlinks remain:\n" + links.join("\n")); process.exit(1); }
console.log("deployed supervisor to", out);
