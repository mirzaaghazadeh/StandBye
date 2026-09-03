// Unit tests for full-text message search: the messages-fts migration, the quoting rules in
// Db.searchMessages, and the search_messages team tool.
//
// The suite runs against ../dist (see helpers.mjs), so this file reads the compiled db.js.

import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import Database from "better-sqlite3";
import { tempDir, makeCrew } from "./helpers.mjs";
import { Db } from "../dist/db.js";
import { TEAM_TOOLS } from "../dist/tools/team-tools.js";

let n = 0;
/** A message with every field insertMessage writes; override anything per test. */
function msg(overrides = {}) {
  n += 1;
  return {
    id: `m${n}`,
    channelId: "general",
    authorId: "ada",
    authorName: "Ada",
    kind: "message",
    text: "hello world",
    mentions: [],
    depth: 0,
    runId: null,
    questionId: null,
    createdAt: new Date(Date.parse("2026-09-03T10:00:00Z") + n * 1000).toISOString(),
    ...overrides,
  };
}

test("messages are searchable as soon as they are inserted, newest first", () => {
  const db = new Db(tempDir());
  db.insertMessage(msg({ text: "we deploy the migration today" }));
  db.insertMessage(msg({ text: "lunch plans? the deploy window is at four" }));
  db.insertMessage(msg({ text: "unrelated chatter about icons" }));
  const hits = db.searchMessages("deploy");
  assert.deepEqual(
    hits.map((m) => m.text),
    ["lunch plans? the deploy window is at four", "we deploy the migration today"],
  );
});

test("filters narrow the search by channel, author and since", () => {
  const db = new Db(tempDir());
  const early = "2026-09-03T08:00:00.000Z";
  const late = "2026-09-03T12:00:00.000Z";
  db.insertMessage(msg({ text: "deploy the api fix", channelId: "general", authorId: "ada", createdAt: early }));
  db.insertMessage(msg({ text: "deploy the api fix", channelId: "dev", authorId: "kai", authorName: "Kai", createdAt: late }));
  assert.equal(db.searchMessages("deploy", { channelId: "dev" })[0].authorId, "kai");
  assert.equal(db.searchMessages("deploy", { channelId: "dev" }).length, 1);
  assert.equal(db.searchMessages("deploy", { authorId: "ada" })[0].channelId, "general");
  assert.equal(db.searchMessages("deploy", { since: "2026-09-03T10:00:00Z" })[0].authorId, "kai");
  assert.equal(db.searchMessages("deploy", { since: "2026-09-03T13:00:00Z" }).length, 0);
  assert.equal(db.searchMessages("deploy").length, 2);
});

test("free text that looks like FTS syntax cannot break or redirect the search", () => {
  const db = new Db(tempDir());
  db.insertMessage(msg({ text: "AND the OR NOT plan" }));
  db.insertMessage(msg({ text: 'say "hello" loudly' }));
  // operator words are searched as words, never applied as operators
  assert.equal(db.searchMessages("AND").length, 1);
  // punctuation and unbalanced quotes cannot throw
  assert.deepEqual(db.searchMessages("deploy AND ("), []);
  assert.deepEqual(db.searchMessages('"unbalanced'), []);
  assert.deepEqual(db.searchMessages("-hyphen: Weird*"), []);
  // quotes in the query are escaped, so a quoted phrase in the archive is findable
  assert.equal(db.searchMessages('"hello" loudly').length, 1);
  // blank queries return nothing rather than everything
  assert.deepEqual(db.searchMessages(""), []);
  assert.deepEqual(db.searchMessages("   "), []);
});

test("the messages-fts migration backfills messages stored before it", () => {
  const dir = tempDir();
  const db = new Db(dir);
  db.insertMessage(msg({ text: "the deploy decision was friday" }));
  // Wind the database back to the pre-FTS shape: drop the index objects and stamp the
  // version the previous schema produced — exactly what an existing install looks like.
  const probe = new Database(path.join(dir, "crew.db"));
  probe.exec("DROP TRIGGER messages_fts_ai; DROP TRIGGER messages_fts_ad; DROP TRIGGER messages_fts_au; DROP TABLE messages_fts;");
  probe.pragma("user_version = 1");
  probe.close();
  const reopened = new Db(dir);
  assert.deepEqual(
    reopened.searchMessages("deploy").map((m) => m.text),
    ["the deploy decision was friday"],
  );
});

test("deleting messages keeps the index consistent for later inserts", () => {
  const db = new Db(tempDir());
  db.insertMessage(msg({ text: "deploy notes" }));
  db.insertMessage(msg({ channelId: "dev", text: "deploy notes too" }));
  assert.equal(db.searchMessages("deploy").length, 2);
  db.deleteAllChannels();
  assert.deepEqual(db.searchMessages("deploy"), []);
  // a corrupted external-content index would throw or miss on the next insert
  db.insertMessage(msg({ text: "fresh deploy talk" }));
  assert.deepEqual(
    db.searchMessages("fresh").map((m) => m.text),
    ["fresh deploy talk"],
  );
});

test("the search_messages tool finds history and names missing channels", async (t) => {
  const { crew } = makeCrew(t);
  const search = TEAM_TOOLS.find((x) => x.name === "search_messages");
  crew.postMessage({ channel: "general", authorId: "ada", text: "we chose sqlite for the search index" });
  const ctx = { crew, agentId: "kai", run: { id: "r1" }, depth: 0 };
  const out = await search.handler({ q: "sqlite" }, ctx);
  assert.match(out, /^\[\d{2}-\d{2} \d{2}:\d{2}\] Ada in #general: /);
  assert.match(out, /sqlite for the search index/);
  assert.match(await search.handler({ q: "nothing-matches-this" }, ctx), /Nothing in the history matches/);
  assert.match(await search.handler({ q: "x", channel: "nope" }, ctx), /No channel named nope/);
});
