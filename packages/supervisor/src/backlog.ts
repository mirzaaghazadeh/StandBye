import fs from "node:fs";
import path from "node:path";
import { nanoid } from "nanoid";
import type { BacklogItem, BacklogStatus } from "@crew/shared";

/**
 * The team's own list of what is worth doing.
 *
 * A team that finds its own work needs somewhere for an idea to live between being noticed and
 * being built. Without it every idea dies with the run that had it: the morning standup
 * reinvents a plan from `git log` and TODOs, and something spotted on Tuesday afternoon is gone
 * by Wednesday unless the same agent happens to notice it twice.
 *
 * It is a JSON file in the team folder rather than a table in `crew.db` on purpose. The backlog
 * is *setup*, not history — it travels with the project, it is committed, and the owner can read
 * it and edit it in their editor or review it in a diff like anything else in the repo.
 */
export class Backlog {
  constructor(private readonly dir: string) {}

  private get file(): string {
    return path.join(this.dir, "backlog.json");
  }

  list(): BacklogItem[] {
    let rows: BacklogItem[];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as unknown;
      rows = Array.isArray(parsed) ? (parsed as BacklogItem[]).filter((r) => r && typeof r.id === "string") : [];
    } catch {
      return [];
    }
    // Rank first, then oldest first, so an unranked idea never jumps a ranked one.
    return rows.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || a.createdAt.localeCompare(b.createdAt));
  }

  /** What an agent should be looking at: ranked, still live, newest ideas last. */
  open(): BacklogItem[] {
    return this.list().filter((i) => i.status !== "done" && i.status !== "dropped");
  }

  get(id: string): BacklogItem | undefined {
    return this.list().find((i) => i.id === id);
  }

  private write(rows: BacklogItem[]): void {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(rows, null, 2) + "\n");
  }

  add(input: { title: string; detail?: string; rationale?: string; addedBy: string; size?: BacklogItem["size"]; rank?: number; status?: BacklogStatus }): BacklogItem {
    const now = new Date().toISOString();
    const rows = this.list();
    const item: BacklogItem = {
      id: nanoid(8),
      title: input.title.trim(),
      detail: (input.detail ?? "").trim(),
      rationale: (input.rationale ?? "").trim(),
      status: input.status ?? "idea",
      addedBy: input.addedBy,
      claimedBy: null,
      // A new idea goes to the back unless someone ranks it, so nobody can jump the queue by
      // simply having thought of it most recently.
      rank: input.rank ?? (rows.reduce((max, r) => Math.max(max, r.rank ?? 0), 0) + 10),
      size: input.size ?? "medium",
      branch: null,
      pr: null,
      outcome: null,
      createdAt: now,
      updatedAt: now,
    };
    this.write([...rows, item]);
    return item;
  }

  update(id: string, patch: Partial<Omit<BacklogItem, "id" | "createdAt" | "addedBy">>): BacklogItem {
    const rows = this.list();
    const i = rows.findIndex((r) => r.id === id);
    if (i < 0) throw new Error(`No backlog item ${id}`);
    const next = { ...rows[i]!, ...patch, id, updatedAt: new Date().toISOString() };
    rows[i] = next;
    this.write(rows);
    return next;
  }

  /**
   * Take an item. Refuses one somebody else is already building, so two agents woken by the same
   * standup cannot quietly do the same work twice.
   */
  claim(id: string, agentId: string): BacklogItem {
    const item = this.get(id);
    if (!item) throw new Error(`No backlog item ${id}`);
    if (item.status === "done" || item.status === "dropped") throw new Error(`"${item.title}" is already ${item.status}`);
    if (item.claimedBy && item.claimedBy !== agentId) throw new Error(`"${item.title}" is already being done by ${item.claimedBy}`);
    return this.update(id, { status: "claimed", claimedBy: agentId });
  }

  /** Is there anything worth an agent's time right now? Used to decide whether an idle check-in should go looking. */
  hasReadyWork(): boolean {
    return this.open().some((i) => i.status === "idea" || i.status === "ready");
  }

  /** A compact view for a prompt: the top of the list, with who has what. */
  summary(limit = 12): string {
    const open = this.open().slice(0, limit);
    if (!open.length) return "";
    const lines = open.map((i) => {
      const who = i.claimedBy ? ` · ${i.claimedBy}` : "";
      const size = i.size === "medium" ? "" : ` · ${i.size}`;
      return `- [${i.id}] (${i.status}${who}${size}) ${i.title}${i.detail ? ` — ${i.detail.split("\n")[0]!.slice(0, 120)}` : ""}`;
    });
    const hidden = this.open().length - open.length;
    if (hidden > 0) lines.push(`- …and ${hidden} more; use list_backlog to see them.`);
    return lines.join("\n");
  }
}
