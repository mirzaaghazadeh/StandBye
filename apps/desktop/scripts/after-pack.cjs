// electron-builder afterPack hook: copy the deployed supervisor (with its flat node_modules)
// into the app bundle's Resources. extraResources silently drops node_modules, so we copy by hand.
// Signing is electron-builder's own job and happens after this hook — see mac.identity in
// electron-builder.yml for why the bundle must end up sealed one way or another.
const fs = require("node:fs");
const path = require("node:path");

module.exports = async function afterPack(context) {
  const src = path.join(__dirname, "..", "resources", "supervisor");
  if (!fs.existsSync(src)) throw new Error("resources/supervisor is missing; run `pnpm deploy-supervisor` first");
  const isMac = context.electronPlatformName === "darwin";
  const appName = context.packager.appInfo.productFilename;
  const app = path.join(context.appOutDir, `${appName}.app`);
  const resources = isMac ? path.join(app, "Contents", "Resources") : path.join(context.appOutDir, "resources");
  const dest = path.join(resources, "supervisor");
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true, dereference: true, filter: (p) => !p.endsWith(".map") });
  const probe = path.join(dest, "node_modules", "nanoid", "package.json");
  if (!fs.existsSync(probe)) throw new Error("supervisor node_modules did not make it into the bundle");
  console.log(`  • copied supervisor to ${dest}`);
};
