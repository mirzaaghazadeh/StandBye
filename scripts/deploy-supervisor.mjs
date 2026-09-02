#!/usr/bin/env node
// Produces apps/desktop/resources/supervisor: the built supervisor with a flat, symlink-free
// node_modules so electron-builder can copy it verbatim into the app bundle.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const src = path.join(root, "packages/supervisor");
const shared = path.join(root, "packages/shared");
const out = path.join(root, "apps/desktop/resources/supervisor");

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.cpSync(path.join(src, "dist"), path.join(out, "dist"), { recursive: true, filter: (p) => !p.endsWith(".map") && !p.endsWith(".d.ts") });

const pkg = JSON.parse(fs.readFileSync(path.join(src, "package.json"), "utf8"));
const deps = { ...pkg.dependencies };
delete deps["@crew/shared"]; // copied in below as real files
fs.writeFileSync(path.join(out, "package.json"), JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: "module", main: "dist/index.js", dependencies: deps }, null, 2));

const r = spawnSync("npm", ["install", "--omit=dev", "--no-package-lock", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: out, stdio: "inherit", env: { ...process.env, COREPACK_ENABLE_STRICT: "0", npm_config_workspaces: "false" } });
if (r.status !== 0) { console.error("npm install failed"); process.exit(1); }

const sharedOut = path.join(out, "node_modules/@crew/shared");
fs.mkdirSync(sharedOut, { recursive: true });
fs.cpSync(path.join(shared, "dist"), path.join(sharedOut, "dist"), { recursive: true, filter: (p) => !p.endsWith(".map") });
fs.copyFileSync(path.join(shared, "package.json"), path.join(sharedOut, "package.json"));

// Prove the tree resolves before packaging.
const t = spawnSync(process.execPath, ["-e", "import('./dist/crew.js').then(()=>console.log('supervisor tree ok')).catch(e=>{console.error(e.message);process.exit(1)})"], { cwd: out, stdio: "inherit" });
if (t.status !== 0) process.exit(1);
fs.rmSync(path.join(out, "node_modules/.bin"), { recursive: true, force: true }); // only symlinks live there
const links = spawnSync("find", [path.join(out, "node_modules"), "-type", "l"], { encoding: "utf8" }).stdout.trim();
if (links) { console.error("symlinks remain:\n" + links); process.exit(1); }
console.log("deployed supervisor to", out);
