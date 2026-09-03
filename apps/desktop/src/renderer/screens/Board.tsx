import { useMemo, useState, type ReactElement } from "react";
import { TASK_COLUMNS, type Task, type TaskColumn } from "@crew/shared";
import { store, useStore } from "../state/store";
import { Button, IconButton, Popup, Segmented, Toolbar } from "../ui/kit";
import { Ic } from "../ui/icons";

const COLUMN_LABEL: Record<TaskColumn, string> = { todo: "To do", doing: "In progress", done: "Done" };

type Draft = { id: string | null; title: string; detail: string; column: TaskColumn; assignee: string | null };

const blankDraft = (column: TaskColumn): Draft => ({ id: null, title: "", detail: "", column, assignee: null });

/**
 * The team's kanban board: every task the owner or an agent filed, in three columns. Cards are read
 * from the store (kept live by `tasks.updated` pushes); the editor below the columns is local state,
 * saved through the tasks RPC. Clicking a card edits it; "New task" starts a blank one in To do.
 */
export function BoardScreen(): ReactElement {
  const tasks = useStore((s) => s.tasks);
  const agents = useStore((s) => s.agents);
  const team = useStore((s) => s.team);
  const [draft, setDraft] = useState<Draft | null>(null);

  const byColumn = useMemo(() => {
    const m: Record<TaskColumn, Task[]> = { todo: [], doing: [], done: [] };
    for (const t of tasks) m[t.column].push(t);
    for (const c of TASK_COLUMNS) m[c].sort((a, b) => a.position - b.position);
    return m;
  }, [tasks]);

  const ownerName = team?.ownerName || "You";
  const editing = draft?.id ? tasks.find((t) => t.id === draft.id) ?? null : null;

  const filedBy = (t: Task): string =>
    t.createdBy === "owner" ? ownerName : agents.find((a) => a.id === t.createdBy)?.name ?? "an agent";
  const assigneeName = (t: Task): string => {
    if (!t.assignee) return "Unclaimed";
    if (t.assignee === "owner") return ownerName;
    return agents.find((a) => a.id === t.assignee)?.name ?? "Unknown";
  };

  const open = (t: Task): void => setDraft({ id: t.id, title: t.title, detail: t.detail ?? "", column: t.column, assignee: t.assignee });

  const canSave = Boolean(draft && draft.title.trim());
  async function save(): Promise<void> {
    if (!draft || !canSave) return;
    const patch = { title: draft.title.trim(), detail: draft.detail.trim() || null, column: draft.column, assignee: draft.assignee };
    if (draft.id) await store.updateTask(draft.id, patch);
    else await store.createTask(patch.title, patch.detail, patch.column);
    setDraft(null);
  }
  async function remove(): Promise<void> {
    if (!draft?.id) return;
    await store.deleteTask(draft.id);
    setDraft(null);
  }

  return (
    <div className="pane">
      <Toolbar
        title="Board"
        subtitle={tasks.length === 0 ? "Work the team will pick up, card by card" : `${byColumn.todo.length} to do · ${byColumn.doing.length} in progress · ${byColumn.done.length} done`}
      >
        <Button sm primary icon={<Ic.Plus size={13} />} onClick={() => setDraft(blankDraft("todo"))}>New task</Button>
      </Toolbar>

      <div className="board">
        {TASK_COLUMNS.map((c) => (
          <div className="board-col" key={c}>
            <div className="board-col-h">
              <span>{COLUMN_LABEL[c]}</span>
              <span className="pill">{byColumn[c].length}</span>
            </div>
            <div className="board-cards">
              {byColumn[c].map((t) => (
                <button type="button" key={t.id} className={"board-card" + (draft?.id === t.id ? " sel" : "")} onClick={() => open(t)}>
                  <span className="board-card-t">{t.title}</span>
                  {t.detail && <span className="board-card-d">{t.detail}</span>}
                  <span className="board-card-f">
                    <Ic.Person size={11} stroke="var(--ink-5)" />
                    {assigneeName(t)}
                    <span className="hint">filed by {filedBy(t)}</span>
                  </span>
                </button>
              ))}
              {byColumn[c].length === 0 && <div className="board-empty">Nothing here.</div>}
            </div>
          </div>
        ))}
      </div>

      {draft && (
        <div className="board-editor">
          <div className="board-editor-h">
            <span className="grp-t">{draft.id ? "Edit task" : "New task"}</span>
            <IconButton onClick={() => setDraft(null)}><Ic.X size={13} /></IconButton>
          </div>
          <input
            className="field"
            placeholder="What needs doing?"
            value={draft.title}
            autoFocus
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter" && canSave) void save(); }}
          />
          <textarea
            className="field board-detail"
            placeholder="Context, files, what done looks like…"
            value={draft.detail}
            onChange={(e) => setDraft({ ...draft, detail: e.target.value })}
          />
          <div className="board-editor-row">
            <Segmented
              value={draft.column}
              options={TASK_COLUMNS.map((c) => ({ value: c, label: COLUMN_LABEL[c] }))}
              onChange={(column) => setDraft({ ...draft, column })}
            />
            <Popup
              value={draft.assignee ?? ""}
              options={[{ value: "", label: "Unclaimed" }, ...agents.map((a) => ({ value: a.id, label: a.name }))]}
              onChange={(v) => setDraft({ ...draft, assignee: v || null })}
            />
            <span style={{ flex: 1 }} />
            {editing && <span className="hint">Filed by {filedBy(editing)}</span>}
            {draft.id && <Button sm danger icon={<Ic.Trash size={12} />} onClick={() => void remove()}>Delete</Button>}
            <Button sm primary disabled={!canSave} onClick={() => void save()}>{draft.id ? "Save" : "Add to board"}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
