// The app's own screens, rebuilt from the desktop UI kit with static demo data.
import { Ic } from "@kit/icons";
import { Avatar, Button, Checkbox, Group, Segmented, IconButton, KV, KindPill, Money, Pill, Popup, Progress, RunPill, STATUS_COLOR, SearchField, StatusPill, UserAvatar, ago, dur, hhmm, modelLabel } from "@kit/kit";
import { type Agent, type Task, type TaskColumn } from "@crew/shared";
import { agents, questions, runs, rules, spentToday, tasks, team, triggerLabel } from "./data";
import { devTeam, type DemoTeam } from "./teams";

function Lights() {
  return (
    <div className="side-drag" style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 14px" }}>
      {["#ff5f57", "#febc2e", "#28c840"].map((c) => <i key={c} style={{ width: 12, height: 12, borderRadius: 999, background: c, border: "1px solid rgba(0,0,0,0.12)" }} />)}
    </div>
  );
}

function Sidebar({ active, d }: { active: "home" | "inbox" | "board" | "runs"; d: DemoTeam }) {
  const needs = d.openQuestions;
  const team = d;
  const agents = d.agents;
  const spentToday = agents.reduce((s, a) => s + a.spentTodayUsd, 0);
  return (
    <div className="side mock-side">
      <Lights />
      <div className="side-ws">
        <Avatar name={team.name} size={18} color="#1d1c1a" ink="#f5f4f1" />
        <span className="side-ws-name">{team.name}</span>
        <Ic.UpDown size={11} stroke="var(--ink-5)" />
      </div>
      <div className="sec">Team</div>
      <div className={"srow" + (active === "home" ? " srow-on" : "")}><Ic.Home size={14} stroke={active === "home" ? "var(--accent)" : "var(--ink-3)"} /><span className="grow">Home</span></div>
      <div className={"srow" + (active === "inbox" ? " srow-on" : "")}><Ic.Inbox size={14} stroke={active === "inbox" ? "var(--accent)" : "var(--ink-3)"} /><span className="grow">Inbox</span>{needs > 0 && <span className="badge">{needs}</span>}</div>
      <div className={"srow" + (active === "board" ? " srow-on" : "")}><Ic.Note size={14} stroke={active === "board" ? "var(--accent)" : "var(--ink-3)"} /><span className="grow">Board</span></div>
      <div className={"srow" + (active === "runs" ? " srow-on" : "")}><Ic.Runs size={14} stroke={active === "runs" ? "var(--accent)" : "var(--ink-3)"} /><span className="grow">Runs</span></div>
      <div className="srow"><Ic.Sparkle size={14} stroke="var(--ink-3)" /><span className="grow">Skills</span></div>
      <div className="sec" style={{ display: "flex", alignItems: "center" }}>
        <span style={{ flex: 1 }}>Channels</span>
        <span className="ibtn" style={{ width: 20, height: 18 }}><Ic.Plus size={11} /></span>
      </div>
      <div className="srow"><Ic.Hash size={14} stroke="var(--ink-3)" /><span className="grow">general</span></div>
      {team.channels.map((c) => (
        <div key={c.name} className="srow"><Ic.Hash size={14} stroke="var(--ink-3)" /><span className="grow">{c.name}</span></div>
      ))}
      <div className="sec">Direct chats</div>
      {agents.map((a) => (
        <div key={a.id} className="srow">
          <span style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
            <Avatar agent={a} size={18} />
            <span className="dot" style={{ position: "absolute", right: -2, bottom: -1, width: 7, height: 7, background: STATUS_COLOR[a.status], boxShadow: "0 0 0 1.5px var(--side-solid)" }} />
          </span>
          <span className="grow">{a.name}</span>
          <span className="hint">{a.role.split(" ")[0]?.toLowerCase()}</span>
        </div>
      ))}
      <div className="grow" />
      <div className="side-spend">
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11 }}>
          <span style={{ color: "var(--ink-3)" }}>Spend today</span>
          <span className="mono">${spentToday.toFixed(2)} / ${team.dailyCapUsd}</span>
        </div>
        <span className="bar" style={{ marginTop: 6 }}><i style={{ width: `${(spentToday / team.dailyCapUsd) * 100}%` }} /></span>
      </div>
      <div className="srow" style={{ marginBottom: 10 }}><Ic.Settings size={14} stroke="var(--ink-3)" /><span className="grow">Settings</span></div>
    </div>
  );
}

/**
 * The lower half of Home: what is waiting on the owner, above the status bar. The rows come from
 * the team being shown, not from a single global list — the research team on screen must not be
 * asking the dev team's questions.
 */
function NeedsYouMock({ d }: { d: DemoTeam }) {
  const now = Date.now();
  const at = (mins: number) => hhmm(new Date(now + mins * 60_000).toISOString());
  return (
    <div style={{ height: 230, flexShrink: 0, display: "flex", flexDirection: "column", background: "var(--bg)" }}>
      <div className="pane-h">
        <span>Needs you</span>
        {d.asks.length > 0 && <span className="badge">{d.asks.length}</span>}
        <span className="grow" />
        <span style={{ fontWeight: 400, color: "var(--accent)" }}>Open Inbox</span>
      </div>
      <div style={{ flex: 1, overflow: "hidden" }}>
        {d.asks.length === 0 && (
          <div style={{ padding: "18px 12px", color: "var(--ink-5)", fontSize: 12 }}>
            Nothing waiting on you. When an agent needs a decision it lands here and in the Inbox, with a default it will fall back to if you're away.
          </div>
        )}
        {d.asks.slice(0, 2).map((q) => {
          const agent = d.agents.find((a) => a.name === q.from);
          return (
            <div key={q.title} className="need">
              <Avatar agent={agent} size={24} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{q.from}</span>
                  <KindPill kind={q.kind} />
                  <span style={{ fontSize: 11, color: "var(--ink-4)" }}>{q.minsAgo} min ago</span>
                </div>
                <div style={{ marginTop: 2, fontWeight: 500 }} className="cell">{q.title}</div>
                <div className="mono" style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 3 }}>
                  If you don't answer: {q.defaultAnswer} at {at(q.defaultInMinutes)}
                </div>
              </div>
              <div className="actions" style={{ flexShrink: 0, justifyContent: "flex-end" }}>
                {q.options.slice(0, 2).map((o) => <Button key={o} primary={o === q.recommended}>{o}</Button>)}
                <Button>Reply…</Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * The agent inspector, which is where the owner actually turns the dials: the model, when it wakes,
 * what it may touch and what it may spend. Every control here exists in the app — the mock only
 * stops them from doing anything.
 */
function InspectorMock({ agent }: { agent: Agent }) {
  const wh = agent.heartbeat.workHours;
  const noop = () => undefined;
  return (
    <div className="insp mock-hide-md">
      <div className="grp" style={{ display: "flex", alignItems: "center", gap: 10, padding: 14 }}>
        <Avatar agent={agent} size={34} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600 }}>{agent.name}</div>
          <div style={{ fontSize: 11, color: "var(--ink-4)" }} className="cell">{agent.role} · since {new Date(agent.createdAt).toLocaleDateString([], { month: "short", day: "numeric" })}</div>
        </div>
        <IconButton><Ic.Pause size={14} /></IconButton>
      </div>
      <Group title="Model">
        <KV k="Model"><Pill mono>{modelLabel(agent.model)}</Pill></KV>
        <KV k="Check-ins on"><Pill mono>{modelLabel(agent.checkinModel)}</Pill></KV>
      </Group>
      <Group title="Wake-ups">
        <KV k="Check in every"><Popup value={String(agent.heartbeat.everyMinutes)} options={[{ value: String(agent.heartbeat.everyMinutes), label: `${agent.heartbeat.everyMinutes} min` }]} onChange={noop} /></KV>
        <KV k="Work hours">{wh ? <span className="mono" style={{ fontSize: 11 }}>{wh.start}–{wh.end}</span> : "Around the clock"}</KV>
        <KV k="On events">
          <span style={{ display: "flex", flexDirection: "column", gap: 5, padding: "4px 0" }}>
            <Checkbox checked label="Mentioned in a channel" />
            <Checkbox checked label="Asked a question by a teammate" />
            <Checkbox checked label="Given a task" />
          </span>
        </KV>
      </Group>
      <Group title="Permissions">
        <KV k="Edit repo"><Popup value="allow" options={PERM} onChange={noop} /></KV>
        <KV k="Run commands"><Popup value="allow" options={PERM} onChange={noop} /></KV>
        <KV k="Push to main"><Popup value="ask" options={PERM} onChange={noop} ask /></KV>
        <KV k="Network"><Popup value="ask" options={PERM} onChange={noop} ask /></KV>
      </Group>
      <Group title="Budget">
        <KV k="Today"><Progress value={agent.spentTodayUsd} max={agent.budget.dailyUsd} /><Money v={agent.spentTodayUsd} /></KV>
        <KV k="Cap"><Money v={agent.budget.dailyUsd} muted /><span style={{ color: "var(--ink-5)", fontSize: 11 }}>per day</span></KV>
      </Group>
      <div style={{ padding: "12px 14px", display: "flex", gap: 6 }}>
        <Button style={{ flex: 1 }}>Soul &amp; Rules…</Button>
        <Button style={{ flex: 1 }}>Memory ({agent.memoryCount})</Button>
      </div>
      <div style={{ padding: "0 14px 12px", display: "flex", gap: 6 }}>
        <Button style={{ flex: 1 }}>Talk to {agent.name}…</Button>
        <Button style={{ flex: 1 }}>Check in now</Button>
      </div>
    </div>
  );
}

const PERM = [{ value: "allow", label: "Allow" }, { value: "ask", label: "Ask me" }, { value: "block", label: "Block" }];

export function HomeMock({ demo = devTeam, className = "" }: { demo?: DemoTeam; className?: string }) {
  const d = demo;
  const agents = d.agents;
  const working = agents.filter((a) => a.status === "working").length;
  const needs = agents.filter((a) => a.status === "needs_you").length;
  const idle = agents.filter((a) => a.status === "idle").length;
  const selected = agents[d.selected] ?? agents[0]!;
  return (
    <div className={"mock " + className}>
      <div className="app">
        <Sidebar active="home" d={d} />
        <div className="main">
          <div className="tb">
            <IconButton disabled><Ic.Back size={14} /></IconButton>
            <IconButton disabled><Ic.Fwd size={14} /></IconButton>
            <div className="tb-title"><b>Home</b><span>{agents.length} agents · {working} working · {needs} needs you · {idle} idle</span></div>
            <div className="grow" />
            <span className="mock-hide-sm"><SearchField /></span>
            <span className="mock-hide-sm"><Button icon={<Ic.Pause size={12} />}>Pause</Button></span>
            <span className="mock-hide-sm"><Button icon={<Ic.Plus size={12} />}>Add Teammate…</Button></span>
            <Button primary icon={<Ic.Plus size={12} />}>New Team…</Button>
            <IconButton on><Ic.Sidebar size={15} /></IconButton>
          </div>
          <div className="body">
            <div className="split-v">
              <div className="th">
                <span style={{ width: 170, flexShrink: 0 }}>Agent</span>
                <span style={{ width: 104, flexShrink: 0 }}>Status</span>
                <span style={{ flex: 1 }}>Doing now</span>
                <span style={{ width: 100, flexShrink: 0 }} className="mock-hide-sm">Model</span>
                <span style={{ width: 52, flexShrink: 0 }}>Since</span>
                <span style={{ width: 60, flexShrink: 0, textAlign: "right" }}>Today</span>
              </div>
              <div style={{ flex: 1, background: "var(--surface)" }}>
                {agents.map((a, i) => (
                  <div key={a.id} className={["tr", i % 2 === 1 && "tr-alt", a.id === selected.id && "tr-sel"].filter(Boolean).join(" ")}>
                    <span style={{ width: 170, flexShrink: 0, display: "flex", alignItems: "center", gap: 8 }}>
                      <Avatar agent={a} size={22} />
                      <span className="cell"><b style={{ fontWeight: 500 }}>{a.name}</b><span style={{ color: "var(--ink-4)" }}> · {a.role}</span></span>
                    </span>
                    <span style={{ width: 104, flexShrink: 0 }}><StatusPill status={a.status} /></span>
                    <span style={{ flex: 1 }} className="cell">{a.statusText}</span>
                    <span style={{ width: 100, flexShrink: 0, color: "var(--ink-3)" }} className="cell mock-hide-sm">{modelLabel(a.model)}</span>
                    <span style={{ width: 52, flexShrink: 0, color: "var(--ink-4)" }}>{ago(a.lastRunAt)}</span>
                    <span style={{ width: 60, flexShrink: 0, textAlign: "right" }}><Money v={a.spentTodayUsd} /></span>
                  </div>
                ))}
              </div>
              <div className="divider" />
              <NeedsYouMock d={d} />
            </div>
            <InspectorMock agent={selected} />
          </div>
          <div className="status">
            <span>Supervisor running</span>
            <span>Work hours {d.hours}</span>
            <span className="grow" />
            <span>Team cap ${d.dailyCapUsd}/day</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export function InboxMock() {
  const q = questions[0]!;
  const from = agents.find((a) => a.id === q.fromAgentId)!;
  const count = (k: string) => questions.filter((x) => k === "all" || x.kind === k).length;
  return (
    <div className="mock mock-sm">
      <div className="app">
        <div className="main">
          <div className="tb">
            <div className="tb-title"><b>Inbox</b></div>
            <div style={{ marginLeft: 16 }}>
              <Segmented value="all" onChange={() => undefined} options={[
                { value: "all", label: <>All <Count n={count("all")} /></> },
                { value: "question", label: <>Questions <Count n={count("question")} /></> },
                { value: "approval", label: <>Approvals <Count n={count("approval")} /></> },
                { value: "report", label: <>Reports <Count n={count("report")} /></> },
              ]} />
            </div>
            <div className="grow" />
            <UserAvatar size={22} />
          </div>
          <div className="body">
            <div className="list-pane mock-hide-sm" style={{ width: 250 }}>
              {questions.map((x, i) => (
                <div key={x.id} className={"li" + (i === 0 ? " li-sel" : "")}>
                  <span className="dot" style={{ width: 7, height: 7, marginTop: 7, background: "var(--accent)" }} />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontWeight: 600 }}>{agents.find((a) => a.id === x.fromAgentId)?.name}</span>
                      <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>{hhmm(x.createdAt)}</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 1 }}><KindPill kind={x.kind} /><span className="cell" style={{ fontWeight: i === 0 ? 500 : 400 }}>{x.title}</span></div>
                    {x.defaultAt && <div className="cell" style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 2 }}>Auto-answers {x.defaultAnswer} at {hhmm(x.defaultAt)}</div>}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ flex: 1, minWidth: 0, background: "var(--surface)", display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div style={{ padding: "20px 28px 16px", borderBottom: "1px solid var(--border-faint)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <KindPill kind={q.kind} />
                  <span style={{ fontSize: 12, color: "var(--ink-4)" }}>{hhmm(q.createdAt)} · waiting {ago(q.createdAt)}</span>
                  <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--accent)" }}>Dismiss</span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 600, marginTop: 8 }}>{q.title}</div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}><Avatar agent={from} /><span style={{ fontWeight: 500 }}>{from.name}</span><span style={{ color: "var(--ink-4)" }}>{from.role}</span></div>
              </div>
              <div style={{ flex: 1, minHeight: 0, padding: "18px 28px", display: "grid", gridTemplateColumns: "minmax(0, 1fr) 260px", gap: 28, alignContent: "start" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                  <div>
                    <div className="grp-t" style={{ marginBottom: 6 }}>Why I'm asking</div>
                    <div style={{ color: "var(--ink-2)" }}>{q.body}</div>
                  </div>
                  <div>
                    <div className="grp-t" style={{ marginBottom: 8 }}>Your answer</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {q.options.map((o) => (
                        <div key={o} className={"opt" + (o === q.recommended ? " opt-on" : "")}>
                          <span className={"rad" + (o === q.recommended ? " rad-on" : "")} />
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 600 }}>{o}{o === q.recommended && <span style={{ marginLeft: 6 }}><Pill bg="var(--green-bg)" ink="var(--green-ink)">{from.name}&apos;s pick</Pill></span>}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <Checkbox checked={false} label="Save as a team decision so nobody asks this again" />
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <Button primary lg>Send Answer</Button>
                    <span className="grow" />
                    <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>No answer by {hhmm(q.defaultAt)} → {q.defaultAnswer}</span>
                  </div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ border: "1px solid var(--border-faint)", borderRadius: 7, background: "var(--bg)", padding: 12 }}>
                    <div className="grp-t">Context</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 7, fontSize: 12 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}><Ic.Runs size={13} stroke="var(--ink-3)" /><span style={{ color: "var(--accent)" }}>The run that asked</span></div>
                    </div>
                  </div>
                  <div style={{ border: "1px solid var(--border-faint)", borderRadius: 7, background: "var(--bg)", padding: 12 }}>
                    <div className="grp-t">What {from.name} does meanwhile</div>
                    <div style={{ fontSize: 12, color: "var(--ink-2)" }}>Keeps working on other things. Continues this the moment you answer.</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)" }}>{n}</span>;
}

export function RunsMock() {
  const total = runs.reduce((s, r) => s + r.costUsd, 0);
  return (
    <div className="mock mock-sm">
      <div className="app">
        <div className="main">
          <div className="tb">
            <div className="tb-title"><b>Runs</b><span>{runs.length} runs · ${total.toFixed(2)} · 0 failed</span></div>
            <div className="grow" />
            <span className="mock-hide-sm"><Segmented value="today" options={[{ value: "today", label: "Today" }, { value: "week", label: "This Week" }, { value: "all", label: "All" }]} onChange={() => undefined} /></span>
            <span className="mock-hide-sm"><SearchField width={160} /></span>
          </div>
          <div className="th">
            <span style={{ width: 50 }}>Time</span>
            <span style={{ width: 104 }}>Agent</span>
            <span style={{ width: 150 }} className="mock-hide-sm">Why it woke up</span>
            <span style={{ flex: 1 }}>Summary</span>
            <span style={{ width: 46, textAlign: "right" }}>Steps</span>
            <span style={{ width: 74, textAlign: "right" }}>Duration</span>
            <span style={{ width: 56, textAlign: "right" }}>Cost</span>
            <span style={{ width: 88, paddingLeft: 16 }}>Status</span>
          </div>
          {runs.map((r, i) => {
            const a = agents.find((x) => x.id === r.agentId)!;
            const muted = r.status === "noop";
            return (
              <div key={r.id} className={"tr tr-sm" + (i % 2 ? " tr-alt" : "")}>
                <span className="mono" style={{ width: 50, fontSize: 11, color: "var(--ink-4)" }}>{hhmm(r.createdAt)}</span>
                <span style={{ width: 104, display: "flex", gap: 6, alignItems: "center" }} className="cell"><Avatar agent={a} size={18} /><span className="cell">{a.name}</span></span>
                <span className="cell mock-hide-sm" style={{ width: 150, color: "var(--ink-3)" }}>{triggerLabel(r.trigger)}</span>
                <span style={{ flex: 1, color: muted ? "var(--ink-4)" : undefined }} className="cell">{r.summary}</span>
                <span className="mono" style={{ width: 46, textAlign: "right", fontSize: 11 }}>{r.stepCount || ""}</span>
                <span className="mono" style={{ width: 74, textAlign: "right", fontSize: 11, color: "var(--ink-4)" }}>{dur(r.startedAt, r.finishedAt)}</span>
                <span style={{ width: 56, textAlign: "right" }}><Money v={r.costUsd} muted={r.costUsd < 0.005} /></span>
                <span style={{ width: 88, paddingLeft: 16 }}><RunPill status={r.status} /></span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const COLUMN_LABEL: Record<TaskColumn, string> = { todo: "To do", doing: "In progress", done: "Done" };

/** The shared board. Same three columns and the same card as the app, on the demo team's tasks. */
export function BoardMock() {
  const name = (id: string | null) => (id ? agents.find((a) => a.id === id)?.name ?? id : "Unclaimed");
  const filedBy = (t: Task) => (t.createdBy === "user" ? "you" : name(t.createdBy));
  const done = tasks.filter((t) => t.column === "done").length;
  return (
    <div className="mock">
      <div className="app">
        <Sidebar active="board" d={devTeam} />
        <div className="main">
          <div className="tb">
            <div className="tb-title"><b>Board</b><span>{tasks.filter((t) => t.column === "todo").length} to do · {tasks.filter((t) => t.column === "doing").length} in progress · {done} done</span></div>
            <div className="grow" />
            <Button sm primary icon={<Ic.Plus size={13} />}>New task</Button>
          </div>
          <div className="board">
            {(["todo", "doing", "done"] as TaskColumn[]).map((c) => {
              const cards = tasks.filter((t) => t.column === c);
              return (
                <div className="board-col" key={c}>
                  <div className="board-col-h"><span>{COLUMN_LABEL[c]}</span><span className="pill">{cards.length}</span></div>
                  <div className="board-cards">
                    {cards.map((t) => (
                      <div key={t.id} className="board-card">
                        <span className="board-card-t">{t.title}</span>
                        {t.detail && <span className="board-card-d">{t.detail}</span>}
                        <span className="board-card-f">
                          <Ic.Person size={11} stroke="var(--ink-5)" />
                          {name(t.assignee)}
                          <span className="hint">filed by {filedBy(t)}</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export function RulesMock() {
  const style = { allow: { bg: "var(--green-bg)", ink: "var(--green-ink)" }, ask: { bg: "var(--amber-bg)", ink: "var(--amber-ink)" }, block: { bg: "var(--red-bg)", ink: "var(--red-ink)" } };
  return (
    <div className="mock mock-sm">
      <div className="app">
        <div className="main">
          {/* The header the app puts over the rules table, word for word (screens/AgentSheet.tsx). */}
          <div style={{ display: "flex", alignItems: "center", height: 28, padding: "0 10px", background: "var(--bg)", borderBottom: "1px solid var(--border)", fontSize: 11, fontWeight: 700, color: "var(--ink-5)", gap: 8 }}>
            <span style={{ flex: 1 }}>Rules Kai can&apos;t break</span>
            <span style={{ fontWeight: 500 }}>Enforced by the app, not the model</span>
          </div>
          {rules.map((r) => (
            <div key={r.pattern} className="rule" style={{ background: "var(--surface)" }}>
              <span className="mono" style={{ width: 200, flexShrink: 0, fontSize: 11.5 }}>{r.pattern}</span>
              <span style={{ flex: 1, color: "var(--ink-4)" }} className="mock-hide-sm">{r.label}</span>
              <span className="pop" style={{ background: style[r.behavior].bg, color: style[r.behavior].ink, borderColor: "transparent", width: 78, justifyContent: "space-between" }}>{r.behavior === "ask" ? "Ask me" : r.behavior === "allow" ? "Allow" : "Block"}<Ic.UpDown size={9} /></span>
            </div>
          ))}
          <div className="rule" style={{ background: "var(--surface)", borderBottom: "none" }}>
            <span className="field mono" style={{ width: 200, flexShrink: 0, color: "var(--ink-5)" }}>Bash(git push*)</span>
            <span style={{ flex: 1, fontSize: 11, color: "var(--ink-4)" }}>Tool name or Tool(glob). First match wins, most specific first.</span>
            <Button sm icon={<Ic.Plus size={11} />}>Add rule</Button>
          </div>
          <div className="pane-h" style={{ borderTop: "1px solid var(--border)" }}><Ic.Dollar size={13} />Budgets</div>
          <div style={{ background: "var(--surface)", padding: "6px 0" }}>
            {agents.map((a) => (
              <div key={a.id} className="kv" style={{ padding: "0 10px" }}>
                <span className="k" style={{ width: 70, textAlign: "left" }}>{a.name}</span>
                <span className="v"><Progress value={a.spentTodayUsd} max={a.budget.dailyUsd} color={a.spentTodayUsd / a.budget.dailyUsd > 0.6 ? "var(--amber)" : "var(--green)"} /><Money v={a.spentTodayUsd} /><span style={{ color: "var(--ink-5)", fontSize: 11 }}>/ ${a.budget.dailyUsd} per {a.budget.capBy}</span></span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
