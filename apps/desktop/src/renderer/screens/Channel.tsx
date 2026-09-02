import { useEffect, useRef, useState } from "react";
import type { Message, Question } from "@crew/shared";
import { store, useStore } from "../state/store";
import { Ic } from "../ui/icons";
import { Avatar, Button, Group, IconButton, KindPill, Toolbar, UserAvatar, hhmm, isToday } from "../ui/kit";

interface Decision { id: string; title: string; answer: string; by: string; createdAt: string }

// Selectors must return a stable reference while data is loading, or useSyncExternalStore re-renders forever.
const EMPTY_MESSAGES: Message[] = [];

export function ChannelScreen({ channelId }: { channelId: string }) {
  const channel = useStore((s) => s.channels.find((c) => c.id === channelId));
  const agents = useStore((s) => s.agents);
  const team = useStore((s) => s.team);
  const messages = useStore((s) => s.messages[channelId] ?? EMPTY_MESSAGES);
  const [showInspector, setShowInspector] = useState(true);
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { void store.loadMessages(channelId); }, [channelId]);
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [messages.length, channelId]);

  const members = agents.filter((a) => channel?.members.includes(a.id));
  const send = async () => {
    const t = text.trim();
    if (!t) return;
    setText("");
    await store.sendMessage(channelId, t);
  };

  return (
    <>
      <Toolbar title={`#${channel?.name ?? channelId}`} subtitle={`${members.map((m) => m.name).join(", ")}${members.length ? " and you" : "You"}${channel?.purpose ? ` · ${channel.purpose}` : ""}`}>
        <IconButton on={showInspector} onClick={() => setShowInspector((v) => !v)}><Ic.Sidebar size={15} /></IconButton>
      </Toolbar>
      <div className="body">
        <div className="split-v" style={{ background: "var(--surface)" }}>
          <div ref={listRef} className="scroll" style={{ flex: 1, minHeight: 0, paddingBottom: 8 }}>
            {messages.length === 0 && <div className="empty" style={{ height: "100%", fontSize: 12 }}>No messages yet. Say something, or mention an agent with @.</div>}
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
              return (
                <div key={m.id}>
                  {newDay && <div className="day"><i /><b>{isToday(m.createdAt) ? "Today" : new Date(m.createdAt).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</b><i /></div>}
                  <MessageRow m={m} />
                </div>
              );
            })}
          </div>
          <div style={{ flexShrink: 0, padding: "10px 18px 12px", borderTop: "1px solid var(--border-soft)" }}>
            <div className="compose">
              <textarea rows={1} placeholder={`Message #${channel?.name ?? channelId}`} value={text} onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
              <IconButton onClick={() => void send()} disabled={!text.trim()} style={{ color: text.trim() ? "var(--accent)" : undefined }}><Ic.Send size={15} /></IconButton>
            </div>
            <div style={{ fontSize: 11, color: "var(--ink-5)", marginTop: 6 }}>Return to send · @name to address an agent · agents see this channel and reply when it concerns them</div>
          </div>
        </div>
        {showInspector && <ChannelInspector channelId={channelId} purpose={channel?.purpose ?? ""} members={members.map((m) => m.id)} ownerName={team?.ownerName ?? "You"} />}
      </div>
    </>
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
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <KindPill kind={q.kind} />
        <span style={{ fontSize: 11, color: "var(--ink-4)" }}>
          {q.toId === "user" ? "Asked you" : `Asked ${target?.name ?? q.toId}`} · {hhmm(q.createdAt)}
          {open && q.defaultAt ? ` · defaults to ${q.defaultAnswer} at ${hhmm(q.defaultAt)}` : ""}
        </span>
      </div>
      <div style={{ fontWeight: 600, marginTop: 6 }}>{q.title}</div>
      {q.body && q.body !== q.title && <div style={{ color: "var(--ink-3)", marginTop: 2 }} className="sel">{q.body}</div>}
      {open && q.toId === "user" ? (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          {quick.map((o, i) => <Button key={o} primary={o === q.recommended || (!q.recommended && i === 0)} onClick={() => void store.answerQuestion(q.id, o, q.kind === "question")}>{o}</Button>)}
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
            <div key={id} style={{ display: "flex", alignItems: "center", gap: 8 }}><Avatar agent={a} size={20} /><span style={{ flex: 1 }}>{a.name}</span><span style={{ fontSize: 11, color: "var(--ink-4)" }}>{a.role.toLowerCase()}</span></div>
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
