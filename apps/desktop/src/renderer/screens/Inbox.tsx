import { useEffect, useState } from "react";
import type { Question, QuestionKind } from "@crew/shared";
import { store, useStore } from "../state/store";
import { Ic } from "../ui/icons";
import { Avatar, Button, Checkbox, KindPill, Pill, Segmented, Toolbar, ago, hhmm } from "../ui/kit";

type Filter = "all" | "question" | "approval" | "report";
const matches = (f: Filter, k: QuestionKind) => f === "all" || (f === "approval" ? k === "approval" || k === "hire" : k === f);

export function InboxScreen({ questionId }: { questionId?: string }) {
  const questions = useStore((s) => s.questions);
  const agents = useStore((s) => s.agents);
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | undefined>(questionId);

  const mine = questions.filter((q) => q.toId === "user");
  const open = mine.filter((q) => q.status === "open" && matches(filter, q.kind)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const resolved = mine.filter((q) => q.status !== "open" && matches(filter, q.kind)).sort((a, b) => (b.answeredAt ?? b.createdAt).localeCompare(a.answeredAt ?? a.createdAt)).slice(0, 20);
  const count = (f: Filter) => mine.filter((q) => q.status === "open" && matches(f, q.kind)).length;

  useEffect(() => { if (questionId) setSelectedId(questionId); }, [questionId]);
  useEffect(() => { if (!selectedId || !mine.some((q) => q.id === selectedId)) setSelectedId(open[0]?.id); }, [open.length, selectedId, mine.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = mine.find((q) => q.id === selectedId);
  const agentOf = (id: string) => agents.find((a) => a.id === id);
  const selectNext = (afterId: string) => { const rest = open.filter((q) => q.id !== afterId); setSelectedId(rest[0]?.id); };

  return (
    <>
      <Toolbar title="Inbox">
        <div style={{ marginRight: "auto" }}>
          <Segmented value={filter} onChange={setFilter} options={[
            { value: "all", label: <>All <Count n={count("all")} /></> },
            { value: "question", label: <>Questions <Count n={count("question")} /></> },
            { value: "approval", label: <>Approvals <Count n={count("approval")} /></> },
            { value: "report", label: <>Reports <Count n={count("report")} /></> },
          ]} />
        </div>
      </Toolbar>
      <div className="body">
        <div className="list-pane">
          {open.map((q) => <ListItem key={q.id} q={q} name={agentOf(q.fromAgentId)?.name ?? q.fromAgentId} selected={q.id === selectedId} onSelect={() => setSelectedId(q.id)} />)}
          {open.length === 0 && <div style={{ padding: "18px 12px", fontSize: 12, color: "var(--ink-5)" }}>Nothing open.</div>}
          {resolved.length > 0 && <div className="li-sec">Resolved</div>}
          {resolved.map((q) => <ListItem key={q.id} q={q} name={agentOf(q.fromAgentId)?.name ?? q.fromAgentId} selected={q.id === selectedId} onSelect={() => setSelectedId(q.id)} />)}
        </div>
        {selected ? <Detail key={selected.id} q={selected} onDone={() => selectNext(selected.id)} /> : (
          <div className="empty" style={{ background: "var(--surface)" }}><Ic.Inbox size={32} stroke="var(--ink-6)" strokeWidth={1.6} /><span>Nothing waiting on you.</span></div>
        )}
      </div>
    </>
  );
}

function Count({ n }: { n: number }) {
  return <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)" }}>{n}</span>;
}

function ListItem({ q, name, selected, onSelect }: { q: Question; name: string; selected: boolean; onSelect: () => void }) {
  const open = q.status === "open";
  const sub = open
    ? q.defaultAt ? `Auto-answers ${q.defaultAnswer} at ${hhmm(q.defaultAt)}` : q.channelId ? `#${q.channelId}` : ""
    : q.status === "answered" ? (q.answeredBy === "default" ? `Default applied: ${q.answer}` : `You answered ${q.answer}`) : q.status === "dismissed" ? "Dismissed" : "Expired";
  return (
    <button className={"li" + (selected ? " li-sel" : "")} style={{ opacity: open ? 1 : 0.7 }} onClick={onSelect}>
      <span className="dot" style={{ width: 7, height: 7, marginTop: 7, background: open ? "var(--accent)" : "transparent" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}><span style={{ fontWeight: 600 }}>{name}</span><span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>{hhmm(q.createdAt)}</span></div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 1 }}><KindPill kind={q.kind} /><span className="cell" style={{ fontWeight: open ? 500 : 400 }}>{q.title}</span></div>
        {sub && <div className="cell" style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 2 }}>{sub}</div>}
      </div>
    </button>
  );
}

function Detail({ q, onDone }: { q: Question; onDone: () => void }) {
  const agent = useStore((s) => s.agents.find((a) => a.id === q.fromAgentId));
  const team = useStore((s) => s.team);
  const open = q.status === "open";
  const options = q.options.length ? q.options : q.kind === "approval" || q.kind === "hire" ? ["Approve", "Decline"] : [];
  const [choice, setChoice] = useState<string>(q.recommended ?? options[0] ?? "other");
  const [other, setOther] = useState("");
  const [remember, setRemember] = useState(q.kind === "question");
  const answer = choice === "other" ? other.trim() : choice;
  const payload = q.payload ?? {};
  const submit = async () => { if (!answer) return; await store.answerQuestion(q.id, answer, remember); onDone(); };
  const name = agent?.name ?? q.fromAgentId;

  return (
    <div style={{ flex: 1, minWidth: 0, background: "var(--surface)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "20px 28px 16px", borderBottom: "1px solid var(--border-faint)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <KindPill kind={q.kind} />
          <span style={{ fontSize: 12, color: "var(--ink-4)" }}>
            {q.channelId ? <>Asked in <a onClick={() => store.navigate({ name: "channel", channelId: q.channelId! })}>#{q.channelId}</a> · </> : null}{hhmm(q.createdAt)}
            {open ? ` · waiting ${ago(q.createdAt)}` : q.status === "answered" ? ` · ${q.answeredBy === "default" ? "default applied" : "answered"} ${hhmm(q.answeredAt)}` : ` · ${q.status}`}
          </span>
          {open && <a style={{ marginLeft: "auto", fontSize: 12 }} onClick={() => { void store.dismissQuestion(q.id); onDone(); }}>Dismiss</a>}
        </div>
        <div className="sel" style={{ fontSize: 18, fontWeight: 600, marginTop: 8 }}>{q.title}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}><Avatar agent={agent} name={name} /><span style={{ fontWeight: 500 }}>{name}</span><span style={{ color: "var(--ink-4)" }}>{agent?.role}</span></div>
      </div>

      <div className="scroll" style={{ flex: 1, minHeight: 0, padding: "18px 28px", display: "grid", gridTemplateColumns: "minmax(0, 1fr) 300px", gap: 28, alignContent: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {q.body && q.body !== q.title && (
            <div><div className="grp-t" style={{ marginBottom: 6 }}>{q.kind === "report" ? "Report" : q.kind === "hire" ? "Why" : "Why I'm asking"}</div><div className="sel" style={{ color: "var(--ink-2)", whiteSpace: "pre-wrap" }}>{q.body}</div></div>
          )}
          {q.kind === "hire" && (
            <div><div className="grp-t" style={{ marginBottom: 6 }}>Proposed teammate</div>
              <div style={{ fontSize: 12, color: "var(--ink-2)", display: "flex", flexDirection: "column", gap: 3 }}>
                <span><b style={{ fontWeight: 600 }}>{String(payload.name ?? "")}</b> · {String(payload.role ?? "")}</span>
                <span>Provider {String(payload.provider ?? "anthropic")}{payload.model ? ` · ${String(payload.model)}` : ""} · ${Number(payload.dailyBudgetUsd ?? 2)}/day</span>
              </div>
            </div>
          )}
          {open ? (
            <>
              <div>
                <div className="grp-t" style={{ marginBottom: 8 }}>Your answer</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {options.map((o) => (
                    <button key={o} className={"opt" + (choice === o ? " opt-on" : "")} onClick={() => setChoice(o)}>
                      <span className={"rad" + (choice === o ? " rad-on" : "")} />
                      <div style={{ flex: 1 }}><div style={{ fontWeight: 600 }}>{o}{q.recommended === o && <span style={{ marginLeft: 6 }}><Pill bg="var(--green-bg)" ink="var(--green-ink)">{name}'s pick</Pill></span>}</div></div>
                    </button>
                  ))}
                  <button className={"opt" + (choice === "other" ? " opt-on" : "")} onClick={() => setChoice("other")}>
                    <span className={"rad" + (choice === "other" ? " rad-on" : "")} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600 }}>{options.length ? "Something else" : "Reply"}</div>
                      <input className="field" style={{ marginTop: 6, height: 26 }} placeholder={`Tell ${name} what you want instead`} value={other} onChange={(e) => { setOther(e.target.value); setChoice("other"); }} onKeyDown={(e) => { if (e.key === "Enter") void submit(); }} />
                    </div>
                  </button>
                </div>
              </div>
              <Checkbox checked={remember} onChange={setRemember} label="Save as a team decision so nobody asks this again" />
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Button lg primary onClick={() => void submit()} disabled={!answer}>Send Answer</Button>
                {q.channelId && <Button lg onClick={() => store.navigate({ name: "channel", channelId: q.channelId! })}>Discuss in #{q.channelId}</Button>}
                <span className="grow" />
                {q.defaultAt && <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>No answer by {hhmm(q.defaultAt)} → {q.defaultAnswer}</span>}
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: "var(--ink-3)" }}>
              {q.status === "answered" ? <>Answer: <b style={{ fontWeight: 600 }}>{q.answer}</b> · {q.answeredBy === "default" ? "default applied" : `by ${q.answeredBy === "user" ? team?.ownerName ?? "you" : q.answeredBy}`}</> : q.status === "dismissed" ? "Dismissed." : "Expired without an answer."}
            </div>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ border: "1px solid var(--border-faint)", borderRadius: 7, background: "var(--bg)", padding: 12 }}>
            <div className="grp-t">Context</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 7, fontSize: 12 }}>
              {q.channelId && <div style={{ display: "flex", gap: 8, alignItems: "center" }}><Ic.Hash size={13} stroke="var(--ink-3)" /><a onClick={() => store.navigate({ name: "channel", channelId: q.channelId! })}>Thread in #{q.channelId}</a></div>}
              {q.runId && <div style={{ display: "flex", gap: 8, alignItems: "center" }}><Ic.Runs size={13} stroke="var(--ink-3)" /><a onClick={() => store.navigate({ name: "runs", runId: q.runId! })}>The run that asked</a></div>}
              {q.kind === "approval" && payload.tool ? (
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}><Ic.Terminal size={13} stroke="var(--ink-3)" style={{ marginTop: 2 }} /><span className="mono sel" style={{ fontSize: 11, lineHeight: 1.5, wordBreak: "break-all" }}>{String(payload.tool)} {JSON.stringify(payload.input ?? {})}</span></div>
              ) : null}
              {!q.channelId && !q.runId && q.kind !== "approval" && <span style={{ color: "var(--ink-5)" }}>No linked context.</span>}
            </div>
          </div>
          {open && (
            <div style={{ border: "1px solid var(--border-faint)", borderRadius: 7, background: "var(--bg)", padding: 12 }}>
              <div className="grp-t">What {name} does meanwhile</div>
              <div style={{ fontSize: 12, color: "var(--ink-2)" }}>Keeps working on other things. Continues this the moment you answer.</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
