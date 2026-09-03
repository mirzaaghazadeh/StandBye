import fs from "node:fs";
import path from "node:path";

/**
 * Noticing when the owner edits the team by hand.
 *
 * A team is a folder of files precisely so a person can open it in an editor: change a soul,
 * tighten a rule, drop in a whole new agent, edit the backlog. Until now nothing was watching, so
 * an edit sat there unseen — the running app kept showing the old team, the scheduler kept the old
 * cron, and a hand-added agent had no direct chat and never woke up. It only took effect on the
 * next restart, which is not something anyone should have to know.
 *
 * The hard part is that the app writes into this folder constantly — memory after a run, the
 * backlog as items move, agent.json when a model changes — so a naive watcher fires on its own
 * writes forever. What is watched is therefore only the *definition*: what the team is, not what
 * it has been doing. A fingerprint of those files decides whether anything actually changed, so
 * the app's own writes settle without a reload.
 */

/** Files that say what the team *is*. Everything else in the folder is history. */
function definitionFiles(dir: string): string[] {
  const out: string[] = [];
  const add = (p: string) => { if (fs.existsSync(p)) out.push(p); };
  add(path.join(dir, "team.json"));
  add(path.join(dir, "channels.json"));
  add(path.join(dir, "backlog.json"));
  const agents = path.join(dir, "agents");
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(agents, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    for (const f of ["agent.json", "SOUL.md", "RULES.md"]) add(path.join(agents, e.name, f));
  }
  return out;
}

/** Cheap and good enough: which definition files exist, and when each last changed. */
export function fingerprint(dir: string): string {
  return definitionFiles(dir)
    .map((f) => { try { return `${path.relative(dir, f)}:${fs.statSync(f).mtimeMs}`; } catch { return ""; } })
    .filter(Boolean)
    .sort()
    .join("|");
}

export interface FolderWatch { close(): void }

/**
 * Call `onChange` when the team's definition changes on disk and not because of our own write.
 * `settleMs` is deliberately generous: an editor saving a file often produces several events, and
 * a person adding an agent by hand creates a folder and then the files in it.
 */
export function watchTeamFolder(dir: string, onChange: () => void, settleMs = 800): FolderWatch {
  let last = fingerprint(dir);
  let timer: NodeJS.Timeout | null = null;
  let watcher: fs.FSWatcher | null = null;

  const check = (): void => {
    timer = null;
    const now = fingerprint(dir);
    if (now === last) return; // our own write, or a file we do not care about
    last = now;
    onChange();
  };

  try {
    watcher = fs.watch(dir, { recursive: true }, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(check, settleMs).unref();
    });
    // Watching a folder must never be the reason a process refuses to exit. A supervisor stays up
    // because it has work to do, and a test run should end when its tests do.
    watcher.unref();
  } catch {
    // Recursive watching is not available everywhere; the team still works, it just needs a
    // restart to notice a hand edit. Never let this stop a team from loading.
    watcher = null;
  }

  return {
    close(): void {
      if (timer) clearTimeout(timer);
      watcher?.close();
      watcher = null;
    },
  };
}
