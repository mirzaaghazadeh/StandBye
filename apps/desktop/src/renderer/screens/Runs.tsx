import { useMemo, useState, type ReactElement } from "react";
import type { Agent, Run, RunStatus, RunStep, RunStepKind, RunTrigger } from "@crew/shared";
import { store, useStore } from "../state/store";
import { Ic } from "../ui/icons";
import { Avatar, Button, Money, Popup, RunPill, SearchField, Segmented, Toolbar, dur, hhmm, isToday, modelLabel } from "../ui/kit";

type Range = "today" | "week" | "all";
type StatusFilter = "all" | RunStatus;

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "Status: All" },
  { value: "running", label: "Running" },
  { value: "done", label: "Done" },
  { value: "failed", label: "Failed" },
  { value: "needs_you", label: "Needs you" },
  { value: "noop", label: "No-op" },
  { value: "cancelled", label: "Cancelled" },
];

function agentName(agents: Agent[], id: string, owner: string): string {
  if (id === "user") return owner;
  return agents.find((a) => a.id === id)?.name ?? id;
}

/** Plain words: why this agent woke up. */
function triggerLabel(t: RunTrigger, agents: Agent[], owner: string): string {
  switch (t.kind) {
    case "heartbeat": return "Checked in";
    case "schedule": return t.name;
    case "mention": return `${agentName(agents, t.by, owner)} mentioned them`;
    case "task": return `Task from ${agentName(agents, t.from, owner)}`;
    case "answer": return "You answered";
    case "question": return `${agentName(agents, t.from, owner)} asked them`;
    case "escalated": return "Found work";
    case "manual": return `${owner} messaged them`;
    case "resumed": return `Picked up after a restart`;
  }
}

function triggerDescription(t: RunTrigger, agents: Agent[], owner: string): string {
  switch (t.kind) {
    case "heartbeat": return "Scheduled check-in on the cheap model. Escalates to the full model only if there is real work.";
    case "schedule": return `${t.name}: ${t.prompt}`;
    case "mention": return `Mentioned by ${agentName(agents, t.by, owner)} (thread depth ${t.depth}).`;
    case "task": return `${t.title} — from ${agentName(agents, t.from, owner)}. ${t.details}`.trim();
    case "answer": return "A question this agent asked was answered.";
    case "question": return `${agentName(agents, t.from, owner)} asked this agent a question.`;
    case "escalated": return `Check-in found work: ${t.reason}`;
    case "manual": return t.prompt;
    case "resumed": return `Started again after the app stopped part-way through: ${triggerDescription(t.was, agents, owner)}`;
  }
}

function inWeek(iso: string): boolean {
  return Date.now() - new Date(iso).getTime() < 7 * 86400000;
}

function fmtTokens(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

export function RunsScreen({ runId }: { runId?: string }) {
  const runs = useStore((s) => s.runs);
  const agents = useStore((s) => s.agents);
  const team = useStore((s) => s.team);
  const owner = team?.ownerName ?? "You";
  const [range, setRange] = useState<Range>("today");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return runs.filter((r) => {
      if (range === "today" && !isToday(r.createdAt)) return false;
      if (range === "week" && !inWeek(r.createdAt)) return false;
      if (agentFilter !== "all" && r.agentId !== agentFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && !(r.summary + " " + (r.error ?? "")).toLowerCase().includes(q)) return false;
      return true;
    });
  }, [runs, range, agentFilter, statusFilter, search]);

  const selected = (runId ? runs.find((r) => r.id === runId) : undefined) ?? shown[0];
  const totalCost = shown.reduce((s, r) => s + r.costUsd, 0);
  const failed = shown.filter((r) => r.status === "failed").length;

  const agentOptions = [{ value: "all", label: "Agent: All" }, ...agents.map((a) => ({ value: a.id, label: a.name }))];

  return (
    <>
      <Toolbar title="Runs" subtitle={`${shown.length} runs · $${totalCost.toFixed(2)} · ${failed} failed`}>
        <Segmented value={range} onChange={setRange} options={[{ value: "today", label: "Today" }, { value: "week", label: "This Week" }, { value: "all", label: "All" }]} />
        <Popup value={agentFilter} options={agentOptions} onChange={setAgentFilter} />
        <Popup value={statusFilter} options={STATUS_OPTIONS} onChange={setStatusFilter} />
        <SearchField value={search} onChange={setSearch} width={180} />
      </Toolbar>

      <div className="body">
        <div className="split-v">
          <div className="th">
            <span style={{ width: 64 }}>Time</span>
            <span style={{ width: 110 }}>Agent</span>
            <span style={{ width: 170 }}>Why it woke up</span>
            <span style={{ flex: 1 }}>Summary</span>
            <span style={{ width: 52, textAlign: "right" }}>Steps</span>
            <span style={{ width: 72, textAlign: "right" }}>Duration</span>
            <span style={{ width: 60, textAlign: "right" }}>Cost</span>
            <span style={{ width: 96, paddingLeft: 16 }}>Status</span>
          </div>
          <div className="scroll" style={{ flex: 1, minHeight: 0, background: "var(--surface)" }}>
            {shown.length === 0 && (
              <div style={{ padding: "18px 12px", color: "var(--ink-5)", fontSize: 12 }}>
                {runs.length === 0
                  ? "No runs yet. Every time an agent wakes up — a check-in, a mention, a task, an answer from you — it appears here with every file it read, every command it ran and what it cost."
                  : `No runs match these filters. ${runs.length} run${runs.length === 1 ? "" : "s"} in total.`}
              </div>
            )}
            {shown.map((r, i) => (
              <RunRow key={r.id} run={r} alt={i % 2 === 1} selected={selected?.id === r.id} agents={agents} owner={owner} onSelect={() => store.navigate({ name: "runs", runId: r.id })} />
            ))}
          </div>
          <div className="divider" />
          <RunDetail run={selected} agents={agents} owner={owner} />
        </div>
      </div>
    </>
  );
}

function RunRow({ run, alt, selected, agents, owner, onSelect }: { run: Run; alt: boolean; selected: boolean; agents: Agent[]; owner: string; onSelect: () => void }) {
  const agent = agents.find((a) => a.id === run.agentId);
  const muted = run.status === "noop" || run.status === "cancelled";
  const text = run.status === "failed" && run.error ? run.error : run.summary || (run.status === "running" ? "Working…" : run.status === "queued" ? "Waiting for a slot" : "");
  return (
    <div className={["tr", "tr-sm", alt && "tr-alt", selected && "tr-sel"].filter(Boolean).join(" ")} onClick={onSelect}>
      <span className="mono" style={{ width: 64, fontSize: 11, color: "var(--ink-4)" }}>{hhmm(run.createdAt)}</span>
      <span style={{ width: 110, display: "flex", alignItems: "center", gap: 6 }} className="cell">
        <Avatar agent={agent} name={run.agentId} size={18} />
        <span className="cell">{agent?.name ?? run.agentId}</span>
      </span>
      <span className="cell" style={{ width: 170, color: "var(--ink-3)" }} title={triggerLabel(run.trigger, agents, owner)}>{triggerLabel(run.trigger, agents, owner)}</span>
      <span className="cell" style={{ flex: 1, color: run.status === "failed" ? "var(--red-ink)" : muted ? "var(--ink-4)" : undefined }} title={text}>{text}</span>
      <span className="mono" style={{ width: 52, textAlign: "right", fontSize: 11 }}>{run.stepCount || ""}</span>
      <span className="mono" style={{ width: 72, textAlign: "right", fontSize: 11, color: "var(--ink-4)" }}>{dur(run.startedAt, run.finishedAt)}</span>
      <span style={{ width: 60, textAlign: "right" }}><Money v={run.costUsd} muted={run.costUsd < 0.005} /></span>
      <span style={{ width: 96, paddingLeft: 16 }}><RunPill status={run.status} /></span>
    </div>
  );
}

const STEP_ICON: Record<RunStepKind, (p: { size?: number; stroke?: string }) => ReactElement> = {
  read: (p) => <Ic.File {...p} />,
  edit: (p) => <Ic.Edit {...p} />,
  run: (p) => <Ic.Terminal {...p} />,
  git: (p) => <Ic.Branch {...p} />,
  post: (p) => <Ic.Hash {...p} />,
  ask: (p) => <Ic.Question {...p} />,
  memory: (p) => <Ic.Shield {...p} />,
  text: (p) => <Ic.Chat {...p} />,
  info: (p) => <Ic.Clock {...p} />,
  tool: (p) => <Ic.Sparkle {...p} />,
};

const MONO_KINDS: RunStepKind[] = ["read", "edit", "run", "git"];
// Stable empty reference: a selector returning a fresh array each render makes useSyncExternalStore loop.
const EMPTY_STEPS: RunStep[] = [];

function RunDetail({ run, agents, owner }: { run: Run | undefined; agents: Agent[]; owner: string }) {
  const steps = useStore((s) => (run ? s.steps[run.id] ?? EMPTY_STEPS : EMPTY_STEPS));
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const agent = run ? agents.find((a) => a.id === run.agentId) : undefined;

  return (
    <div style={{ height: 330, flexShrink: 0, display: "flex", background: "var(--bg)" }}>
      {!run ? (
        <div className="empty" style={{ fontSize: 12 }}>Select a run to see what happened.</div>
      ) : (
        <>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
            <div className="pane-h" style={{ height: 32 }}>
              <Avatar agent={agent} name={run.agentId} size={18} />
              <span>{agent?.name ?? run.agentId}</span>
              <span style={{ fontWeight: 400, color: "var(--ink-4)" }} className="cell">
                {triggerLabel(run.trigger, agents, owner).replace(/^[A-Z]/, (c) => c.toLowerCase())} · {hhmm(run.startedAt ?? run.createdAt)}{run.finishedAt ? ` to ${hhmm(run.finishedAt)}` : " · still running"} · {steps.length} step{steps.length === 1 ? "" : "s"}
              </span>
              <span className="grow" />
              <span className="mono" style={{ fontWeight: 400, fontSize: 11, color: "var(--ink-4)" }}>
                {modelLabel(run.model)} · {fmtTokens(run.inputTokens)} in / {fmtTokens(run.outputTokens)} out · ${run.costUsd.toFixed(2)}
              </span>
            </div>
            <div className="scroll" style={{ flex: 1, padding: "6px 0", background: "var(--surface)" }}>
              {steps.length === 0 && (
                <div style={{ padding: "12px 14px", color: "var(--ink-5)", fontSize: 12 }}>
                  {run.status === "queued" ? "Waiting for a free slot. Steps appear here the moment it starts." : run.status === "running" ? "Just started; the first step will appear in a moment." : "This run ended before it did anything."}
                </div>
              )}
              {steps.map((s) => <StepRow key={s.id} step={s} open={Boolean(open[s.id])} onToggle={() => setOpen((o) => ({ ...o, [s.id]: !o[s.id] }))} />)}
            </div>
          </div>
          <div style={{ width: 300, flexShrink: 0, borderLeft: "1px solid var(--border)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
            <div>
              <div className="grp-t">Outcome</div>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                {run.status === "failed" ? <Ic.X size={14} stroke="var(--red-ink)" /> : run.status === "running" || run.status === "queued" ? <Ic.Clock size={14} stroke="var(--ink-4)" /> : <Ic.Check size={14} stroke="var(--green)" strokeWidth={2.4} />}
                <span className="sel" style={{ color: run.status === "failed" ? "var(--red-ink)" : undefined }}>
                  {run.status === "failed" ? run.error ?? run.summary ?? "Failed" : run.summary || (run.status === "running" ? "Still working." : run.status === "queued" ? "Queued." : "Finished.")}
                </span>
              </div>
            </div>
            <div>
              <div className="grp-t">Trigger</div>
              <div className="sel" style={{ fontSize: 12, color: "var(--ink-3)" }}>{triggerDescription(run.trigger, agents, owner)}</div>
            </div>
            <div className="grow" />
            <div style={{ display: "flex", gap: 6 }}>
              {(run.status === "running" || run.status === "queued") && <Button style={{ flex: 1 }} danger onClick={() => void store.cancelRun(run.id)}>Cancel</Button>}
              {agent && <Button style={{ flex: 1 }} onClick={() => store.navigate({ name: "agent", agentId: agent.id })}>Open {agent.name}</Button>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StepRow({ step, open, onToggle }: { step: RunStep; open: boolean; onToggle: () => void }) {
  const Icon = STEP_ICON[step.kind];
  const mono = MONO_KINDS.includes(step.kind);
  const hasDetail = Boolean(step.detail);
  return (
    <div>
      <div className="log" onClick={hasDetail ? onToggle : undefined} style={{ cursor: hasDetail ? "default" : undefined }}>
        <span className="when">{hhmm(step.at)}</span>
        <Icon size={13} stroke={step.kind === "ask" ? "var(--accent)" : "var(--ink-3)"} />
        <span className="what">{step.kind}</span>
        <span className={"txt" + (mono ? " mono" : "")} title={step.text}>{step.text}</span>
        {hasDetail && <span style={{ color: "var(--ink-5)" }}>{open ? <Ic.TriDown size={9} /> : <Ic.TriRight size={9} />}</span>}
      </div>
      {open && step.detail && (
        <pre className="mono sel" style={{ margin: "2px 14px 6px 102px", padding: "8px 10px", fontSize: 11, lineHeight: 1.5, background: "var(--bg)", border: "1px solid var(--border-faint)", borderRadius: 6, whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: 180, overflowY: "auto" }}>
          {step.detail}
        </pre>
      )}
    </div>
  );
}
