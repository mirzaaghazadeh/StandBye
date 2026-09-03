#!/usr/bin/env node
// Produces apps/desktop/resources/supervisor: the built supervisor with a flat, symlink-free
// node_modules so electron-builder can copy it verbatim into the app bundle.
//
// Runs on macOS, Windows and Linux. better-sqlite3 is native, so a tree is only valid for one
// platform/arch pair; pass --platform/--arch to fetch prebuilds for a target other than this host
// (the release workflow does that for linux-arm64, which it cross-builds from an x64 runner).
//
//   node scripts/deploy-supervisor.mjs                 # for this machine
//   node scripts/deploy-supervisor.mjs --arch arm64    # cross-fetch arm64 prebuilds
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

const pkg = JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8"));
const deps = { ...pkg.dependencies };
delete deps["@crew/shared"]; // copied in below as real files
fs.writeFileSync(path.join(out, "package.json"), JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: "module", main: "dist/index.js", dependencies: deps }, null, 2));

// npm is npm.cmd on Windows, which needs a shell to resolve.
const r = spawnSync("npm", ["install", "--omit=dev", "--no-package-lock", "--no-audit", "--no-fund", "--loglevel=error"], {
  cwd: out,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: {
    ...process.env,
    COREPACK_ENABLE_STRICT: "0",
    npm_config_workspaces: "false",
    // prebuild-install (better-sqlite3) reads these to pick which prebuilt binary to download.
    npm_config_platform: targetPlatform,
    npm_config_arch: targetArch,
  },
});
if (r.status !== 0) { console.error("npm install failed"); process.exit(1); }

const sharedOut = path.join(out, "node_modules/@crew/shared");
fs.mkdirSync(sharedOut, { recursive: true });
fs.cpSync(path.join(shared, "dist"), path.join(sharedOut, "dist"), { recursive: true, filter: (p) => !p.endsWith(".map") });
fs.copyFileSync(path.join(shared, "package.json"), path.join(sharedOut, "package.json"));

// Prove the tree resolves before packaging. A cross-built tree can't be loaded on this host,
// so there we just confirm the right native binary landed.
if (crossBuilding) {
  const native = path.join(out, "node_modules/better-sqlite3/build/Release/better_sqlite3.node");
  if (!fs.existsSync(native)) { console.error(`no prebuilt better-sqlite3 for ${targetPlatform}-${targetArch}`); process.exit(1); }
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
