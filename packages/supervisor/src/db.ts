import Database from "better-sqlite3";
import path from "node:path";
import type { Channel, Message, Question, Run, RunStep, RunTrigger } from "@crew/shared";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS channels (
  id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, purpose TEXT NOT NULL DEFAULT '', members TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, channel_id TEXT NOT NULL, author_id TEXT NOT NULL, author_name TEXT NOT NULL,
  kind TEXT NOT NULL, text TEXT NOT NULL, mentions TEXT NOT NULL DEFAULT '[]', depth INTEGER NOT NULL DEFAULT 0,
  run_id TEXT, question_id TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_channel ON messages(channel_id, created_at);
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL, from_agent_id TEXT NOT NULL, to_id TEXT NOT NULL, channel_id TEXT,
  title TEXT NOT NULL, body TEXT NOT NULL, options TEXT NOT NULL DEFAULT '[]', recommended TEXT, default_answer TEXT,
  default_at TEXT, status TEXT NOT NULL, answer TEXT, answered_by TEXT, payload TEXT, run_id TEXT,
  created_at TEXT NOT NULL, answered_at TEXT
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, trigger TEXT NOT NULL, status TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '', started_at TEXT, finished_at TEXT, cost_usd REAL NOT NULL DEFAULT 0,
  input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, step_count INTEGER NOT NULL DEFAULT 0,
  error TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS runs_agent ON runs(agent_id, created_at);
CREATE TABLE IF NOT EXISTS run_steps (
  id TEXT PRIMARY KEY, run_id TEXT NOT NULL, at TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, detail TEXT
);
CREATE INDEX IF NOT EXISTS run_steps_run ON run_steps(run_id, at);
CREATE TABLE IF NOT EXISTS agent_state (
  agent_id TEXT PRIMARY KEY, last_heartbeat_at TEXT, last_seen_message_at TEXT
);
CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, answer TEXT NOT NULL, by TEXT NOT NULL, created_at TEXT NOT NULL
);
`;

/**
 * Ordered schema migrations, applied in one transaction at open. MIGRATIONS[i] upgrades a
 * database stamped user_version i to i + 1; after applying, user_version is stamped to
 * MIGRATIONS.length. Each migration must be safe on any database the previous schema could
 * have produced: SQLite has no ADD COLUMN IF NOT EXISTS, so column migrations check
 * PRAGMA table_info themselves instead of assuming the column is missing.
 */
export type Migration = { name: string; apply: (sqlite: Database.Database) => void };

export const MIGRATIONS: Migration[] = [
  {
    name: "channels-kind-and-dm-agent-id",
    // First versioned migration, moved here from the ad-hoc guard that used to run after
    // SCHEMA. The columns may already exist: every install before user_version had them
    // added by that guard, so only alter when missing.
    apply(sqlite) {
      const cols = (sqlite.prepare("PRAGMA table_info(channels)").all() as { name: string }[]).map((c) => c.name);
      if (!cols.includes("kind")) sqlite.exec("ALTER TABLE channels ADD COLUMN kind TEXT NOT NULL DEFAULT 'group'");
      if (!cols.includes("dm_agent_id")) sqlite.exec("ALTER TABLE channels ADD COLUMN dm_agent_id TEXT");
    },
  },
  {
    name: "messages-fts",
    // Full-text index over messages, kept in sync by triggers on the content table and
    // backfilled from whatever is already stored, so an existing team's archive is
    // searchable the moment it opens. FTS5 syntax is never accepted from callers: the
    // search methods quote every token themselves, so user input cannot throw a MATCH
    // error or smuggle in operators (see Db.searchMessages).
    apply(sqlite) {
      sqlite.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
          text, content='messages', content_rowid='rowid', tokenize='porter unicode61'
        );
        CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
          INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
        END;
        CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
        END;
        CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
          INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
        END;
      `);
      // A full reindex of the content table: a no-op cost on a fresh database, and
      // idempotent, so a database that re-runs this migration cannot drift.
      sqlite.exec("INSERT INTO messages_fts(messages_fts) VALUES ('rebuild');");
    },
  },
];

export class Db {
  readonly sqlite: Database.Database;

  constructor(dataDir: string) {
    this.sqlite = new Database(path.join(dataDir, "crew.db"));
    // A failed open must not leak the handle it just opened: close it before letting the
    // error out, so a caller that retries (or a test harness in the same process) starts
    // from a clean slate instead of an orphaned connection.
    try {
      this.sqlite.pragma("journal_mode = WAL");
      this.sqlite.exec(SCHEMA);
      this.migrate();
    } catch (err) {
      this.sqlite.close();
      throw err;
    }
  }

  /**
   * Applies pending migrations in one transaction, then stamps user_version to
   * MIGRATIONS.length. A failing migration aborts open with the database untouched:
   * the transaction rolls back including the version stamp, so the same migration
   * simply runs again on the next boot.
   */
  private migrate(): void {
    const from = this.sqlite.pragma("user_version", { simple: true }) as number;
    if (from >= MIGRATIONS.length) return;
    const run = this.sqlite.transaction(() => {
      for (const migration of MIGRATIONS.slice(from)) migration.apply(this.sqlite);
      this.sqlite.pragma(`user_version = ${MIGRATIONS.length}`);
    });
    run();
  }

  // ---- channels ----
  listChannels(): Channel[] {
    return this.sqlite.prepare("SELECT * FROM channels ORDER BY name").all().map(rowToChannel);
  }
  getChannel(idOrName: string): Channel | undefined {
    const row = this.sqlite.prepare("SELECT * FROM channels WHERE id = ? OR name = ?").get(idOrName, idOrName.replace(/^#/, ""));
    return row ? rowToChannel(row) : undefined;
  }
  upsertChannel(c: Channel): void {
    this.sqlite
      .prepare("INSERT INTO channels (id, name, purpose, members, kind, dm_agent_id) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, purpose=excluded.purpose, members=excluded.members, kind=excluded.kind, dm_agent_id=excluded.dm_agent_id")
      .run(c.id, c.name, c.purpose, JSON.stringify(c.members), c.kind, c.dmAgentId);
  }
  deleteChannel(id: string): void {
    this.sqlite.prepare("DELETE FROM channels WHERE id = ?").run(id);
  }
  deleteAllChannels(): void {
    this.sqlite.exec("DELETE FROM channels; DELETE FROM messages;");
  }

  // ---- messages ----
  insertMessage(m: Message): void {
    this.sqlite
      .prepare("INSERT INTO messages (id, channel_id, author_id, author_name, kind, text, mentions, depth, run_id, question_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .run(m.id, m.channelId, m.authorId, m.authorName, m.kind, m.text, JSON.stringify(m.mentions), m.depth, m.runId, m.questionId, m.createdAt);
  }
  listMessages(channelId: string, limit = 100, before?: string): Message[] {
    const rows = before
      ? this.sqlite.prepare("SELECT * FROM messages WHERE channel_id = ? AND created_at < ? ORDER BY created_at DESC LIMIT ?").all(channelId, before, limit)
      : this.sqlite.prepare("SELECT * FROM messages WHERE channel_id = ? ORDER BY created_at DESC LIMIT ?").all(channelId, limit);
    return rows.map(rowToMessage).reverse();
  }
  messagesSince(channelIds: string[], since: string | null, limit = 60): Message[] {
    if (channelIds.length === 0) return [];
    const placeholders = channelIds.map(() => "?").join(",");
    const rows = this.sqlite
      .prepare(`SELECT * FROM messages WHERE channel_id IN (${placeholders}) AND created_at > ? ORDER BY created_at ASC LIMIT ?`)
      .all(...channelIds, since ?? "", limit);
    return rows.map(rowToMessage);
  }
  /**
   * Full-text search over every channel's messages, newest first. The query is free text
   * from a human or an agent, not FTS5 syntax: it is split on whitespace and every token is
   * wrapped in double quotes, so punctuation, operator words and unbalanced quotes can
   * neither throw a MATCH syntax error nor quietly change what is being searched for.
   * Tokens are ANDed. Use the filters to narrow: channelId to one channel, authorId to one
   * author, since to messages created at or after an ISO timestamp.
   */
  searchMessages(q: string, opts: { channelId?: string; authorId?: string; since?: string; limit?: number } = {}): Message[] {
    const match = q
      .split(/\s+/)
      .filter(Boolean)
      .map((token) => `"${token.replaceAll('"', '""')}"`)
      .join(" ");
    if (!match) return [];
    const where = ["m.rowid IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)"];
    const args: unknown[] = [match];
    if (opts.channelId) { where.push("m.channel_id = ?"); args.push(opts.channelId); }
    if (opts.authorId) { where.push("m.author_id = ?"); args.push(opts.authorId); }
    if (opts.since) { where.push("m.created_at >= ?"); args.push(opts.since); }
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const rows = this.sqlite
      .prepare(`SELECT m.* FROM messages m WHERE ${where.join(" AND ")} ORDER BY m.created_at DESC LIMIT ?`)
      .all(...args, limit);
    return rows.map(rowToMessage);
  }

  getMessage(id: string): Message | undefined {
    const row = this.sqlite.prepare("SELECT * FROM messages WHERE id = ?").get(id);
    return row ? rowToMessage(row) : undefined;
  }
  countMessagesToday(): number {
    const r = this.sqlite.prepare("SELECT COUNT(*) AS n FROM messages WHERE created_at >= ?").get(startOfToday()) as { n: number };
    return r.n;
  }

  // ---- questions ----
  insertQuestion(q: Question): void {
    this.sqlite
      .prepare(
        "INSERT INTO questions (id, kind, from_agent_id, to_id, channel_id, title, body, options, recommended, default_answer, default_at, status, answer, answered_by, payload, run_id, created_at, answered_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      )
      .run(q.id, q.kind, q.fromAgentId, q.toId, q.channelId, q.title, q.body, JSON.stringify(q.options), q.recommended, q.defaultAnswer, q.defaultAt, q.status, q.answer, q.answeredBy, q.payload ? JSON.stringify(q.payload) : null, q.runId, q.createdAt, q.answeredAt);
  }
  updateQuestion(q: Question): void {
    this.sqlite
      .prepare("UPDATE questions SET status=?, answer=?, answered_by=?, answered_at=?, payload=? WHERE id=?")
      .run(q.status, q.answer, q.answeredBy, q.answeredAt, q.payload ? JSON.stringify(q.payload) : null, q.id);
  }
  getQuestion(id: string): Question | undefined {
    const row = this.sqlite.prepare("SELECT * FROM questions WHERE id = ?").get(id);
    return row ? rowToQuestion(row) : undefined;
  }
  listQuestions(opts: { toId?: string; status?: string; limit?: number } = {}): Question[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (opts.toId) { where.push("to_id = ?"); args.push(opts.toId); }
    if (opts.status) { where.push("status = ?"); args.push(opts.status); }
    const sql = `SELECT * FROM questions ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT ?`;
    return this.sqlite.prepare(sql).all(...args, opts.limit ?? 200).map(rowToQuestion);
  }
  expiredQuestions(now: string): Question[] {
    return this.sqlite
      .prepare("SELECT * FROM questions WHERE status = 'open' AND default_at IS NOT NULL AND default_at <= ?")
      .all(now)
      .map(rowToQuestion);
  }

  // ---- runs ----
  insertRun(r: Run): void {
    this.sqlite
      .prepare("INSERT INTO runs (id, agent_id, trigger, status, summary, model, started_at, finished_at, cost_usd, input_tokens, output_tokens, step_count, error, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(r.id, r.agentId, JSON.stringify(r.trigger), r.status, r.summary, r.model, r.startedAt, r.finishedAt, r.costUsd, r.inputTokens, r.outputTokens, r.stepCount, r.error, r.createdAt);
  }
  updateRun(r: Run): void {
    this.sqlite
      .prepare("UPDATE runs SET status=?, summary=?, model=?, started_at=?, finished_at=?, cost_usd=?, input_tokens=?, output_tokens=?, step_count=?, error=? WHERE id=?")
      .run(r.status, r.summary, r.model, r.startedAt, r.finishedAt, r.costUsd, r.inputTokens, r.outputTokens, r.stepCount, r.error, r.id);
  }
  getRun(id: string): Run | undefined {
    const row = this.sqlite.prepare("SELECT * FROM runs WHERE id = ?").get(id);
    return row ? rowToRun(row) : undefined;
  }
  listRuns(opts: { agentId?: string; since?: string; limit?: number } = {}): Run[] {
    const where: string[] = [];
    const args: unknown[] = [];
    if (opts.agentId) { where.push("agent_id = ?"); args.push(opts.agentId); }
    if (opts.since) { where.push("created_at >= ?"); args.push(opts.since); }
    const sql = `SELECT * FROM runs ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY created_at DESC LIMIT ?`;
    return this.sqlite.prepare(sql).all(...args, opts.limit ?? 200).map(rowToRun);
  }
  lastRun(agentId: string): Run | undefined {
    const row = this.sqlite.prepare("SELECT * FROM runs WHERE agent_id = ? AND status NOT IN ('queued') ORDER BY created_at DESC LIMIT 1").get(agentId);
    return row ? rowToRun(row) : undefined;
  }
  /**
   * Close out runs that were still going when the process stopped, and hand them back so they can
   * be picked up again.
   *
   * Marking them failed and walking away used to throw away everything they had done: a run
   * ninety steps into a change lost all of it because the machine slept. The work itself is on
   * disk — the steps, the edits, the commits — so the run is ended here and resumed as a new one
   * that is told what the last one got through.
   */
  recoverStaleRuns(): Run[] {
    const stale = this.sqlite
      .prepare("SELECT * FROM runs WHERE status IN ('running','queued','needs_you')")
      .all()
      .map((r) => rowToRun(r as never));
    if (!stale.length) return [];
    const now = new Date().toISOString();
    this.sqlite
      .prepare("UPDATE runs SET status='failed', error='Stopped part-way through when the supervisor restarted; picked up again in a new run', finished_at=? WHERE status IN ('running','queued','needs_you')")
      .run(now);
    return stale;
  }
  insertStep(s: RunStep): void {
    this.sqlite.prepare("INSERT INTO run_steps (id, run_id, at, kind, text, detail) VALUES (?,?,?,?,?,?)").run(s.id, s.runId, s.at, s.kind, s.text, s.detail);
  }
  listSteps(runId: string): RunStep[] {
    return this.sqlite.prepare("SELECT * FROM run_steps WHERE run_id = ? ORDER BY at ASC").all(runId).map(rowToStep);
  }

  // ---- spend ----
  spentToday(agentId?: string): number {
    const row = agentId
      ? (this.sqlite.prepare("SELECT COALESCE(SUM(cost_usd),0) AS c FROM runs WHERE agent_id = ? AND created_at >= ?").get(agentId, startOfToday()) as { c: number })
      : (this.sqlite.prepare("SELECT COALESCE(SUM(cost_usd),0) AS c FROM runs WHERE created_at >= ?").get(startOfToday()) as { c: number });
    return row.c;
  }
  /** How many times this agent has already woken in the window. Guards against chatter loops. */
  runsSince(agentId: string, sinceIso: string): number {
    const row = this.sqlite.prepare("SELECT COUNT(*) AS n FROM runs WHERE agent_id = ? AND created_at >= ? AND status NOT IN ('cancelled')").get(agentId, sinceIso) as { n: number };
    return row.n;
  }
  spentSince(agentId: string, sinceIso: string): number {
    const row = this.sqlite.prepare("SELECT COALESCE(SUM(cost_usd),0) AS c FROM runs WHERE agent_id = ? AND created_at >= ?").get(agentId, sinceIso) as { c: number };
    return row.c;
  }
  spentTodayByAgent(): Record<string, number> {
    const rows = this.sqlite.prepare("SELECT agent_id, COALESCE(SUM(cost_usd),0) AS c FROM runs WHERE created_at >= ? GROUP BY agent_id").all(startOfToday()) as { agent_id: string; c: number }[];
    return Object.fromEntries(rows.map((r) => [r.agent_id, r.c]));
  }
  checkinSpendToday(): number {
    const row = this.sqlite
      .prepare("SELECT COALESCE(SUM(cost_usd),0) AS c FROM runs WHERE created_at >= ? AND trigger LIKE '%\"heartbeat\"%'")
      .get(startOfToday()) as { c: number };
    return row.c;
  }
  runsToday(): number {
    const row = this.sqlite.prepare("SELECT COUNT(*) AS n FROM runs WHERE created_at >= ?").get(startOfToday()) as { n: number };
    return row.n;
  }

  // ---- agent state ----
  getAgentState(agentId: string): { lastHeartbeatAt: string | null; lastSeenMessageAt: string | null } {
    const row = this.sqlite.prepare("SELECT * FROM agent_state WHERE agent_id = ?").get(agentId) as
      | { last_heartbeat_at: string | null; last_seen_message_at: string | null }
      | undefined;
    return { lastHeartbeatAt: row?.last_heartbeat_at ?? null, lastSeenMessageAt: row?.last_seen_message_at ?? null };
  }
  setAgentState(agentId: string, patch: { lastHeartbeatAt?: string; lastSeenMessageAt?: string }): void {
    const cur = this.getAgentState(agentId);
    this.sqlite
      .prepare("INSERT INTO agent_state (agent_id, last_heartbeat_at, last_seen_message_at) VALUES (?,?,?) ON CONFLICT(agent_id) DO UPDATE SET last_heartbeat_at=excluded.last_heartbeat_at, last_seen_message_at=excluded.last_seen_message_at")
      .run(agentId, patch.lastHeartbeatAt ?? cur.lastHeartbeatAt, patch.lastSeenMessageAt ?? cur.lastSeenMessageAt);
  }

  // ---- decisions ----
  insertDecision(d: { id: string; title: string; answer: string; by: string; createdAt: string }): void {
    this.sqlite.prepare("INSERT INTO decisions (id, title, answer, by, created_at) VALUES (?,?,?,?,?)").run(d.id, d.title, d.answer, d.by, d.createdAt);
  }
  listDecisions(limit = 50): { id: string; title: string; answer: string; by: string; createdAt: string }[] {
    return (this.sqlite.prepare("SELECT * FROM decisions ORDER BY created_at DESC LIMIT ?").all(limit) as { id: string; title: string; answer: string; by: string; created_at: string }[]).map((r) => ({
      id: r.id, title: r.title, answer: r.answer, by: r.by, createdAt: r.created_at,
    }));
  }
}

export function startOfToday(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToChannel(r: any): Channel {
  return { id: r.id, name: r.name, purpose: r.purpose, members: JSON.parse(r.members), kind: r.kind === "dm" ? "dm" : "group", dmAgentId: r.dm_agent_id ?? null };
}
function rowToMessage(r: any): Message {
  return {
    id: r.id, channelId: r.channel_id, authorId: r.author_id, authorName: r.author_name, kind: r.kind, text: r.text,
    mentions: JSON.parse(r.mentions), depth: r.depth, runId: r.run_id, questionId: r.question_id, createdAt: r.created_at,
  };
}
function rowToQuestion(r: any): Question {
  return {
    id: r.id, kind: r.kind, fromAgentId: r.from_agent_id, toId: r.to_id, channelId: r.channel_id, title: r.title, body: r.body,
    options: JSON.parse(r.options), recommended: r.recommended, defaultAnswer: r.default_answer, defaultAt: r.default_at,
    status: r.status, answer: r.answer, answeredBy: r.answered_by, payload: r.payload ? JSON.parse(r.payload) : null,
    runId: r.run_id, createdAt: r.created_at, answeredAt: r.answered_at,
  };
}
function rowToRun(r: any): Run {
  return {
    id: r.id, agentId: r.agent_id, trigger: JSON.parse(r.trigger) as RunTrigger, status: r.status, summary: r.summary, model: r.model,
    startedAt: r.started_at, finishedAt: r.finished_at, costUsd: r.cost_usd, inputTokens: r.input_tokens, outputTokens: r.output_tokens,
    stepCount: r.step_count, error: r.error, createdAt: r.created_at,
  };
}
function rowToStep(r: any): RunStep {
  return { id: r.id, runId: r.run_id, at: r.at, kind: r.kind, text: r.text, detail: r.detail };
}
