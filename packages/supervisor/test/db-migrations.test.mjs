// Unit tests for the versioned schema migrations in db.ts (PRAGMA user_version).
//
// Four cases, per the migrations spec:
//   1. a fresh data dir is born migrated — columns present, user_version stamped;
//   2. a simulated pre-user_version install (channels without kind) is migrated with data intact;
//   3. reopening an already-migrated database is a no-op;
//   4. a failing migration rolls back everything — old version stamp, old columns — and the
//      next boot retries it.
// The suite runs against ../dist (see helpers.mjs), so this file reads the compiled db.js.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { tempDir } from "./helpers.mjs";
import { Db, MIGRATIONS } from "../dist/db.js";

const version = (sqlite) => sqlite.pragma("user_version", { simple: true });
const columns = (sqlite, table) => sqlite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

/** A channels table in the pre-kind shape, the way a database from before user_version looks. */
function seedLegacyChannelsDb(dir) {
  const sqlite = new Database(path.join(dir, "crew.db"));
  sqlite.exec(`
    CREATE TABLE channels (
      id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, purpose TEXT NOT NULL DEFAULT '', members TEXT NOT NULL DEFAULT '[]'
    );
  `);
  sqlite.prepare("INSERT INTO channels (id, name, purpose, members) VALUES ('general', 'general', 'General chat', '[\"kai\"]')").run();
  sqlite.close();
}

test("a fresh data dir is born migrated", (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const db = new Db(dir);
  t.after(() => db.sqlite.close());

  const cols = columns(db.sqlite, "channels");
  assert.ok(cols.includes("kind"), "kind column must exist after open");
  assert.ok(cols.includes("dm_agent_id"), "dm_agent_id column must exist after open");
  assert.equal(version(db.sqlite), MIGRATIONS.length, "user_version must be stamped to the migration count");
});

test("a pre-user_version install is migrated on open, data intact", (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  seedLegacyChannelsDb(dir);

  const db = new Db(dir);
  t.after(() => db.sqlite.close());

  const cols = columns(db.sqlite, "channels");
  assert.ok(cols.includes("kind") && cols.includes("dm_agent_id"), "the migration must add the missing columns");
  assert.equal(version(db.sqlite), MIGRATIONS.length, "user_version must be stamped after migrating");

  const c = db.getChannel("general");
  assert.ok(c, "the pre-migration row must survive");
  assert.equal(c.kind, "group", "kind must get the 'group' default");
  assert.equal(c.dmAgentId, null, "dm_agent_id must be null for old rows");
  assert.equal(c.name, "general");
  assert.equal(c.purpose, "General chat");
});

test("reopening an already-migrated database is a no-op", (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const first = new Db(dir);
  assert.equal(version(first.sqlite), MIGRATIONS.length);
  first.sqlite.close();

  const second = new Db(dir);
  t.after(() => second.sqlite.close());
  assert.equal(version(second.sqlite), MIGRATIONS.length, "reopen must not re-run or re-stamp migrations");
  assert.equal(second.sqlite.prepare("SELECT count(*) AS n FROM channels").get().n, 0, "db still readable, data untouched");
});

test("a failing migration rolls back and retries on the next boot", (t) => {
  const dir = tempDir();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  seedLegacyChannelsDb(dir);

  MIGRATIONS.push({ name: "boom", apply() { throw new Error("boom"); } });
  try {
    assert.throws(() => new Db(dir), /boom/, "open must fail when a migration throws");
  } finally {
    MIGRATIONS.pop();
  }

  const probe = new Database(path.join(dir, "crew.db"));
  assert.equal(version(probe), 0, "the version stamp must roll back with the transaction");
  const cols = columns(probe, "channels");
  assert.ok(!cols.includes("kind"), "the earlier migration's ALTER must roll back too");
  assert.equal(probe.prepare("SELECT count(*) AS n FROM channels").get().n, 1, "the pre-migration row must survive untouched");
  probe.close();

  const db = new Db(dir);
  t.after(() => db.sqlite.close());
  assert.equal(version(db.sqlite), MIGRATIONS.length, "the next open retries the migration from the old stamp");
  assert.ok(db.getChannel("general").kind === "group");
});
