import { useEffect, useRef, useState } from "react";
import type { Agent, Message, Question, Run } from "@crew/shared";
import { store, useStore } from "../state/store";
import { Ic } from "../ui/icons";
import { Avatar, Button, Group, IconButton, KindPill, StatusPill, Toolbar, UserAvatar, hhmm, isToday, modelLabel } from "../ui/kit";
import { Compose } from "../components/Compose";

interface Decision { id: string; title: string; answer: string; by: string; createdAt: string }

// Selectors must return a stable reference while data is loading, or useSyncExternalStore re-renders forever.
const EMPTY_MESSAGES: Message[] = [];

export function short(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}

/** A group channel, or (with dmAgentId) the owner's direct chat with one agent. */
export function ChannelScreen({ channelId, dmAgentId }: { channelId: string; dmAgentId?: string }) {
  const channel = useStore((s) => s.channels.find((c) => c.id === channelId));
  const agents = useStore((s) => s.agents);
  const team = useStore((s) => s.team);
  const messages = useStore((s) => s.messages[channelId] ?? EMPTY_MESSAGES);
  const [showInspector, setShowInspector] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const dmAgent = dmAgentId ? agents.find((a) => a.id === dmAgentId) : undefined;

  useEffect(() => { void store.loadMessages(channelId); }, [channelId]);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; store.markSeen(channelId); }, [messages.length, channelId]);

  const members = dmAgent ? [dmAgent] : agents.filter((a) => channel?.members.includes(a.id));
  const send = (t: string) => { void store.sendMessage(channelId, t); };

  return (
    <>
      {dmAgent ? (
        <Toolbar title={<span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}><Avatar agent={dmAgent} size={18} />{dmAgent.name}</span>} subtitle={`${dmAgent.role} · ${statusLine(dmAgent)}`}>
          <Button onClick={() => { store.selectAgent(dmAgent.id); store.navigate({ name: "home" }); }}>Manage on Home</Button>
          <IconButton on={showInspector} onClick={() => setShowInspector((v) => !v)}><Ic.Sidebar size={15} /></IconButton>
        </Toolbar>
      ) : (
        <Toolbar title={`#${channel?.name ?? channelId}`} subtitle={`${members.map((m) => m.name).join(", ")}${members.length ? " and you" : "You"}${channel?.purpose ? ` · ${channel.purpose}` : ""}`}>
          <IconButton on={showInspector} onClick={() => setShowInspector((v) => !v)}><Ic.Sidebar size={15} /></IconButton>
        </Toolbar>
      )}
      <div className="body">
        <div className="split-v" style={{ background: "var(--surface)" }}>
          <div ref={listRef} className="scroll" style={{ flex: 1, minHeight: 0, paddingBottom: 8 }}>
            {messages.length === 0 && (
              <div className="empty" style={{ height: "100%", fontSize: 12, maxWidth: 420, margin: "0 auto", textAlign: "center", lineHeight: 1.6 }}>
                {dmAgent ? <><Ic.Chat size={28} stroke="var(--ink-6)" strokeWidth={1.6} /><span>Your private chat with {dmAgent.name}.<br />Anything you write here wakes {dmAgent.name} straight away, and stays between the two of you.</span></>
                  : <><Ic.Hash size={28} stroke="var(--ink-6)" strokeWidth={1.6} /><span>Nothing here yet. Write what needs doing and type <b>@</b> to pick the agent who should take it. Everyone in this channel reads along and replies when it concerns them.</span></>}
              </div>
            )}
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
              return (
                <div key={m.id}>
                  {newDay && <div className="day"><i /><b>{isToday(m.createdAt) ? "Today" : new Date(m.createdAt).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</b><i /></div>}
                  <MessageRow m={m} />
                  {m.authorId === "user" && m.mentions.length > 0 && <MessageOutcome m={m} />}
                </div>
              );
            })}
          </div>
          <WorkingNow channelId={channelId} dmAgentId={dmAgentId} messages={messages} />
          <div style={{ flexShrink: 0, padding: "10px 18px 12px", borderTop: "1px solid var(--border-soft)" }}>
            <Compose
              placeholder={dmAgent ? `Message ${dmAgent.name}` : `Message #${channel?.name ?? channelId}`}
              agents={dmAgent ? [] : agents}
              onSend={send}
              hint={dmAgent ? `Return to send · only you and ${dmAgent.name} see this chat` : "Return to send · type @ to pick an agent · agents see this channel and reply when it concerns them"}
            />
          </div>
        </div>
        {showInspector && (dmAgent ? <DmInspector agent={dmAgent} /> : <ChannelInspector channelId={channelId} purpose={channel?.purpose ?? ""} members={members.map((m) => m.id)} ownerName={team?.ownerName ?? "You"} />)}
      </div>
    </>
  );
}

function statusLine(a: Agent): string {
  if (a.status === "working") return a.statusText ? `working: ${a.statusText}` : "working";
  if (a.status === "needs_you") return "waiting for you";
  if (a.status === "idle") return a.nextWakeAt ? `idle · next check-in ${hhmm(a.nextWakeAt)}` : "idle";
  return a.status.replace("_", " ");
}

/**
 * The "typing" line. An agent is shown as working here while it has a run that was triggered
 * from this conversation (a mention of a message in this channel, or any run in a direct chat).
 * The latest recorded step is streamed under its name, so you see what it is doing right now.
 */
function WorkingNow({ channelId, dmAgentId, messages }: { channelId: string; dmAgentId?: string; messages: Message[] }) {
  const runs = useStore((s) => s.runs);
  const steps = useStore((s) => s.steps);
  const agents = useStore((s) => s.agents);
  const ids = new Set(messages.map((m) => m.id));
  const active = runs.filter((r) => {
    if (r.status !== "running" && r.status !== "queued") return false;
    if (dmAgentId) return r.agentId === dmAgentId;
    const t = r.trigger;
    return t.kind === "mention" && ids.has(t.messageId);
  });
  if (active.length === 0) return null;
  return (
    <div style={{ flexShrink: 0, borderTop: "1px solid var(--border-soft)", background: "var(--alt)" }}>
      {active.map((r) => {
        const a = agents.find((x) => x.id === r.agentId);
        const last = steps[r.id]?.at(-1);
        return (
          <div key={r.id} className="typing">
            <Avatar agent={a} name={r.agentId} size={18} />
            <span className="who">{a?.name ?? r.agentId}</span>
            <span className="dots"><i /><i /><i /></span>
            <span className="what" title={last?.text}>{r.status === "queued" ? "waiting for a free slot" : last ? `${last.kind}: ${last.text}` : "reading the conversation"}</span>
            <a onClick={() => store.navigate({ name: "runs", runId: r.id })} style={{ fontSize: 11 }}>open run</a>
          </div>
        );
      })}
    </div>
  );
}

/**
 * What became of a message you sent. Silent while an agent is working (the typing line covers that)
 * and silent once it replies; speaks up only when the message went nowhere, which is the case that
 * used to leave you staring at an empty channel.
 */
function MessageOutcome({ m }: { m: Message }) {
  const runs = useStore((s) => s.runs);
  const agents = useStore((s) => s.agents);
  const waking = useStore((s) => s.waking[m.id]);
  const lines = m.mentions.map((id) => {
    const agent = agents.find((a) => a.id === id);
    const name = agent?.name ?? id;
    const run = runs.find((r) => r.trigger.kind === "mention" && r.trigger.messageId === m.id && r.agentId === id);
    if (!run) {
      if (waking) return { id, icon: "wake" as const, text: `Waking ${name}…` };
      if (agent?.paused) return { id, icon: "warn" as const, text: `${name} is paused, so this is waiting. Resume ${name} on Home.` };
      return { id, icon: "warn" as const, text: `${name} did not pick this up. Try again or check the Runs screen.`, retry: true };
    }
    if (run.status === "failed") return { id, icon: "fail" as const, text: `${name}'s run failed: ${run.error ?? "unknown error"}`, retry: true, runId: run.id };
    if (run.status === "cancelled") return { id, icon: "warn" as const, text: `${name}'s run was cancelled before it finished.`, retry: true, runId: run.id };
    if (run.status === "noop") return { id, icon: "ok" as const, text: `${name} looked and had nothing to add.`, runId: run.id };
    return null; // queued, running, done: the typing line or the reply itself is the feedback
  }).filter((x): x is NonNullable<typeof x> => Boolean(x));
  if (lines.length === 0) return null;
  return (
    <div style={{ padding: "0 18px 4px 52px", display: "flex", flexDirection: "column", gap: 3 }}>
      {lines.map((l) => (
        <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: l.icon === "fail" ? "var(--red-ink)" : "var(--ink-4)", minWidth: 0 }}>
          {l.icon === "wake" ? <span className="dots"><i /><i /><i /></span>
            : l.icon === "fail" ? <Ic.X size={12} stroke="var(--red-ink)" />
            : l.icon === "ok" ? <Ic.Check size={12} stroke="var(--ink-5)" strokeWidth={2.4} />
            : <Ic.Question size={12} stroke="var(--amber)" />}
          <span className="cell" title={l.text}>{l.text}</span>
          {l.retry && <a onClick={() => void store.retryMessage(l.id, m.text)}>Ask again</a>}
          {l.runId && <a onClick={() => store.navigate({ name: "runs", runId: l.runId })}>Open run</a>}
        </div>
      ))}
    </div>
  );
}

function MessageRow({ m }: { m: Message }) {
  const agent = useStore((s) => s.agents.find((a) => a.id === m.authorId));
  const question = useStore((s) => (m.questionId ? s.questions.find((q) => q.id === m.questionId) : undefined));
  if (m.kind === "system") {
    return <div className="sys"><Ic.Clock size={13} stroke="var(--ink-5)" /><span>{hhmm(m.createdAt)} · {m.text}</span></div>;
  }
  const avatar = m.authorId === "user" ? <UserAvatar /> : m.authorId === "system" ? <Avatar name="S" /> : <Avatar agent={agent} name={m.authorName} />;
  return (
    <div className="msg">
      {avatar}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="msg-h"><span className="msg-n">{m.authorName}</span><span className="msg-t">{agent?.role ? `${agent.role} · ` : ""}{hhmm(m.createdAt)}</span></div>
        {m.kind === "question" && question ? <QuestionCard q={question} /> : <div className="msg-body sel">{m.text}</div>}
      </div>
    </div>
  );
}

function QuestionCard({ q }: { q: Question }) {
  const target = useStore((s) => s.agents.find((a) => a.id === q.toId));
  const open = q.status === "open";
  const quick = q.options.length ? q.options.slice(0, 3) : q.kind === "approval" || q.kind === "hire" ? ["Approve", "Decline"] : [];
  return (
    <div className="qcard">
      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
        <KindPill kind={q.kind} />
        <span className="cell" style={{ fontSize: 11, color: "var(--ink-4)", flex: 1 }} title={open && q.defaultAt ? `Defaults to "${q.defaultAnswer}" at ${hhmm(q.defaultAt)}` : undefined}>
          {q.toId === "user" ? "Asked you" : `Asked ${target?.name ?? q.toId}`} · {hhmm(q.createdAt)}
          {open && q.defaultAt ? ` · defaults to "${short(q.defaultAnswer ?? "", 28)}" at ${hhmm(q.defaultAt)}` : ""}
        </span>
      </div>
      <div style={{ fontWeight: 600, marginTop: 6 }}>{q.title}</div>
      {q.body && q.body !== q.title && <div style={{ color: "var(--ink-3)", marginTop: 2 }} className="sel">{q.body}</div>}
      {open && q.toId === "user" ? (
        <div className="actions" style={{ marginTop: 8 }}>
          {quick.map((o, i) => <Button key={o} title={o} primary={o === q.recommended || (!q.recommended && i === 0)} onClick={() => void store.answerQuestion(q.id, o, q.kind === "question")}>{short(o, 48)}</Button>)}
          <Button onClick={() => store.navigate({ name: "inbox", questionId: q.id })}>Reply…</Button>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 6 }}>
          {q.status === "answered" ? `Answered: ${q.answer}` : q.status === "dismissed" ? "Dismissed" : q.status === "expired" ? "Expired" : `Waiting for ${target?.name ?? q.toId}`}
        </div>
      )}
    </div>
  );
}

function DmInspector({ agent }: { agent: Agent }) {
  const runs = useStore((s) => s.runs);
  const recent = runs.filter((r) => r.agentId === agent.id).slice(0, 5);
  return (
    <div className="insp">
      <div className="grp" style={{ display: "flex", alignItems: "center", gap: 10, padding: 14 }}>
        <Avatar agent={agent} size={34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{agent.name}</div>
          <div style={{ fontSize: 11, color: "var(--ink-4)" }} className="cell">{agent.role} · {modelLabel(agent.model)}</div>
        </div>
      </div>
      <Group title="Status">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <StatusPill status={agent.status} />
          {agent.statusText && <div style={{ fontSize: 12, color: "var(--ink-3)" }}>{agent.statusText}</div>}
          {agent.nextWakeAt && agent.status === "idle" && <div style={{ fontSize: 11, color: "var(--ink-4)" }}>Next check-in {hhmm(agent.nextWakeAt)}</div>}
        </div>
      </Group>
      <Group title="Recent runs">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {recent.length === 0 && <div style={{ fontSize: 12, color: "var(--ink-5)" }}>No runs yet.</div>}
          {recent.map((r) => <RunLine key={r.id} r={r} />)}
        </div>
      </Group>
      <div style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
        <Button onClick={() => store.openSheet({ kind: "agent", agentId: agent.id, tab: "soul" })}>Soul &amp; Rules…</Button>
        <Button onClick={() => store.openSheet({ kind: "agent", agentId: agent.id, tab: "memory" })}>Memory ({agent.memoryCount})</Button>
        <Button onClick={() => void store.checkinAgent(agent.id)} disabled={Boolean(agent.currentRunId)}>Check in now</Button>
      </div>
    </div>
  );
}

function RunLine({ r }: { r: Run }) {
  return (
    <a onClick={() => store.navigate({ name: "runs", runId: r.id })} style={{ fontSize: 12, color: "var(--ink-2)", display: "flex", gap: 6, minWidth: 0 }}>
      <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)", flexShrink: 0 }}>{hhmm(r.createdAt)}</span>
      <span className="cell" style={{ flex: 1 }}>{r.summary || r.error || r.status}</span>
    </a>
  );
}

function ChannelInspector({ channelId, purpose, members, ownerName }: { channelId: string; purpose: string; members: string[]; ownerName: string }) {
  const agents = useStore((s) => s.agents);
  const questions = useStore((s) => s.questions);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  useEffect(() => { void store.rpc<Decision[]>("decisions.list").then(setDecisions).catch(() => setDecisions([])); }, [questions.length]);
  const waiting = questions.filter((q) => q.status === "open" && q.channelId === channelId && q.toId === "user");
  return (
    <div className="insp">
      <Group title="About"><div style={{ color: "var(--ink-2)" }}>{purpose || "No purpose set."}</div></Group>
      <Group title="Members">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {members.map((id) => { const a = agents.find((x) => x.id === id); return a ? (
            <a key={id} onClick={() => store.navigate({ name: "dm", agentId: a.id })} style={{ display: "flex", alignItems: "center", gap: 8, color: "inherit" }} title={`Direct chat with ${a.name}`}><Avatar agent={a} size={20} /><span style={{ flex: 1 }}>{a.name}</span><span style={{ fontSize: 11, color: "var(--ink-4)" }}>{a.role.toLowerCase()}</span></a>
          ) : null; })}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}><UserAvatar size={20} /><span style={{ flex: 1 }}>{ownerName}</span><span style={{ fontSize: 11, color: "var(--ink-4)" }}>you</span></div>
        </div>
      </Group>
      <Group title="Decisions">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {waiting.map((q) => (
            <div key={q.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <span style={{ width: 14, height: 14, borderRadius: 999, border: "1.5px solid var(--accent)", marginTop: 2, flexShrink: 0 }} />
              <div><div>{q.title}</div><div style={{ fontSize: 11, color: "var(--q-ink)" }}>Waiting for you{q.defaultAt ? ` · auto ${hhmm(q.defaultAt)}` : ""}</div></div>
            </div>
          ))}
          {decisions.map((d) => (
            <div key={d.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <Ic.Check size={14} stroke="var(--green)" strokeWidth={2.4} style={{ marginTop: 2, flexShrink: 0 }} />
              <div><div>{d.title} → {d.answer}</div><div style={{ fontSize: 11, color: "var(--ink-4)" }}>{d.by === "user" ? ownerName : d.by} · {new Date(d.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}</div></div>
            </div>
          ))}
          {waiting.length === 0 && decisions.length === 0 && <div style={{ fontSize: 12, color: "var(--ink-5)" }}>No decisions yet.</div>}
        </div>
      </Group>
    </div>
  );
}
