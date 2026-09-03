// The app's own screens, rebuilt from the desktop UI kit with static demo data.
import { Ic } from "@kit/icons";
import { Avatar, Button, Group, IconButton, KV, KindPill, Money, Pill, Progress, RunPill, SearchField, StatusPill, UserAvatar, ago, dur, hhmm, modelLabel } from "@kit/kit";
import { agents, questions, runs, rules, spentToday, team, triggerLabel } from "./data";
import { devTeam, type DemoTeam } from "./teams";

function Lights() {
  return (
    <div className="side-drag" style={{ display: "flex", alignItems: "center", gap: 8, padding: "0 14px" }}>
      {["#ff5f57", "#febc2e", "#28c840"].map((c) => <i key={c} style={{ width: 12, height: 12, borderRadius: 999, background: c, border: "1px solid rgba(0,0,0,0.12)" }} />)}
    </div>
  );
}

function Sidebar({ active, d }: { active: "home" | "inbox" | "runs"; d: DemoTeam }) {
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
      <div className="sec">TEAM</div>
      <div className={"srow" + (active === "home" ? " srow-on" : "")}><Ic.Home size={14} /><span className="grow">Home</span></div>
      <div className={"srow" + (active === "inbox" ? " srow-on" : "")}><Ic.Inbox size={14} /><span className="grow">Inbox</span>{needs > 0 && <span className="badge">{needs}</span>}</div>
      <div className={"srow" + (active === "runs" ? " srow-on" : "")}><Ic.Runs size={14} /><span className="grow">Runs</span></div>
      <div className="sec">CHANNELS</div>
      <div className="srow"><Ic.Hash size={14} /><span className="grow">general</span></div>
      {team.channels.map((c) => (
        <div key={c.name} className="srow"><Ic.Hash size={14} /><span className="grow">{c.name}</span><span className="hint">{c.members.length}</span></div>
      ))}
      <div className="sec">AGENTS</div>
      {agents.map((a) => (
        <div key={a.id} className="srow"><Avatar agent={a} size={16} /><span className="grow">{a.name}</span><span className="dot" style={{ background: a.status === "working" ? "var(--green)" : a.status === "needs_you" ? "var(--amber)" : "var(--ink-6)" }} /></div>
      ))}
      <div className="grow" />
      <div className="side-spend">
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 5 }}>
          <span style={{ color: "var(--ink-3)" }}>Today</span>
          <span className="mono">${spentToday.toFixed(2)} / ${team.dailyCapUsd}</span>
        </div>
        <span className="bar"><i style={{ width: `${(spentToday / team.dailyCapUsd) * 100}%` }} /></span>
      </div>
    </div>
  );
}

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
            <span className="mock-hide-sm"><Button icon={<Ic.Pause size={12} />}>Pause All</Button></span>
            <Button primary icon={<Ic.Plus size={12} />}>New Team…</Button>
            <IconButton on><Ic.Sidebar size={15} /></IconButton>
          </div>
          <div className="body">
            <div className="split-v">
              <div className="th">
                <span style={{ width: 150 }}>Agent</span>
                <span style={{ width: 100 }}>Status</span>
                <span style={{ flex: 1 }}>Doing now</span>
                <span style={{ width: 96 }} className="mock-hide-sm">Model</span>
                <span style={{ width: 56, textAlign: "right" }}>Today</span>
              </div>
              <div style={{ flex: 1, background: "var(--surface)" }}>
                {agents.map((a, i) => (
                  <div key={a.id} className={["tr", i % 2 === 1 && "tr-alt", a.id === selected.id && "tr-sel"].filter(Boolean).join(" ")}>
                    <span style={{ width: 150, display: "flex", alignItems: "center", gap: 8 }} className="cell">
                      <Avatar agent={a} size={22} />
                      <span className="cell"><b style={{ fontWeight: 500 }}>{a.name}</b><span style={{ color: "var(--ink-4)" }}> · {a.role}</span></span>
                    </span>
                    <span style={{ width: 100 }}><StatusPill status={a.status} /></span>
                    <span style={{ flex: 1 }} className="cell">{a.statusText}</span>
                    <span style={{ width: 96 }} className="cell mock-hide-sm"><Pill mono>{modelLabel(a.model)}</Pill></span>
                    <span style={{ width: 56, textAlign: "right" }}><Money v={a.spentTodayUsd} /></span>
                  </div>
                ))}
                <div style={{ padding: "12px 12px 0", fontSize: 12, color: "var(--ink-4)" }}>
                  Next check-ins: {agents.map((a) => `${a.name} ${hhmm(a.nextWakeAt)}`).join(" · ")}
                </div>
              </div>
            </div>
            <div className="insp mock-hide-md">
              <Group title="AGENT">
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                  <Avatar agent={selected} size={34} />
                  <div><div style={{ fontWeight: 600 }}>{selected.name}</div><div style={{ fontSize: 12, color: "var(--ink-4)" }}>{selected.role}</div></div>
                </div>
                <KV k="Status"><StatusPill status={selected.status} /></KV>
                <KV k="Model"><Pill mono>{modelLabel(selected.model)}</Pill></KV>
                <KV k="Check-ins"><Pill mono>{modelLabel(selected.checkinModel)}</Pill><span style={{ color: "var(--ink-4)" }}>every {selected.heartbeat.everyMinutes} min</span></KV>
                <KV k="Hours">{selected.heartbeat.workHours?.start}–{selected.heartbeat.workHours?.end}</KV>
              </Group>
              <Group title="BUDGET">
                <KV k="Today"><Progress value={selected.spentTodayUsd} max={selected.budget.dailyUsd} /><Money v={selected.spentTodayUsd} /></KV>
                <KV k="Daily cap"><Money v={selected.budget.dailyUsd} muted /></KV>
                <KV k="Per run"><Money v={selected.budget.perRunUsd} muted /></KV>
              </Group>
              <Group title="RESPONSIBILITIES">
                {selected.responsibilities.map((r) => (
                  <div key={r} style={{ fontSize: 12, padding: "3px 0", display: "flex", gap: 6 }}><Ic.Check size={12} stroke="var(--green)" /><span>{r}</span></div>
                ))}
              </Group>
              <Group title="MEMORY">
                <KV k="Notes">{selected.memoryCount} in MEMORY.md</KV>
                <KV k="Skills">2 in skills/</KV>
              </Group>
            </div>
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
  return (
    <div className="mock mock-sm">
      <div className="app">
        <div className="main">
          <div className="tb">
            <div className="tb-title"><b>Inbox</b><span>{questions.length} open · 2 need an answer</span></div>
            <div className="grow" />
            <UserAvatar size={22} />
          </div>
          <div className="body">
            <div className="list-pane mock-hide-sm" style={{ width: 250 }}>
              <div className="li-sec">NEEDS YOU</div>
              {questions.map((x, i) => {
                const f = agents.find((a) => a.id === x.fromAgentId)!;
                return (
                  <div key={x.id} className={"li" + (i === 0 ? " li-sel" : "")}>
                    <Avatar agent={f} size={22} />
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}><KindPill kind={x.kind} /><span style={{ fontSize: 11, color: "var(--ink-5)", marginLeft: "auto" }}>{ago(x.createdAt)}</span></div>
                      <div className="cell" style={{ fontSize: 12, marginTop: 4, fontWeight: i === 0 ? 500 : 400 }}>{x.title}</div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ flex: 1, minWidth: 0, padding: 18, display: "flex", flexDirection: "column", gap: 12, background: "var(--bg)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Avatar agent={from} size={24} />
                <span style={{ fontWeight: 500 }}>{from.name}</span>
                <span style={{ color: "var(--ink-4)", fontSize: 12 }}>{from.role}</span>
                <KindPill kind={q.kind} />
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-4)" }}>defaults in {ago(q.defaultAt).replace(/^(\d+)/, "$1")}</span>
              </div>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{q.title}</div>
              <div style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.5 }}>{q.body}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {q.options.map((o) => (
                  <div key={o} className={"opt" + (o === q.recommended ? " opt-on" : "")}>
                    <span className={"rad" + (o === q.recommended ? " rad-on" : "")} />
                    <span style={{ flex: 1 }}>{o}</span>
                    {o === q.recommended && <Pill bg="var(--q-bg)" ink="var(--q-ink)">recommended</Pill>}
                    {o === q.defaultAnswer && <Pill>default</Pill>}
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <Button primary lg icon={<Ic.Check size={12} />}>Answer</Button>
                <Button lg>Remember this decision</Button>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--ink-5)" }}>Rex keeps working on something else meanwhile</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function RunsMock() {
  return (
    <div className="mock mock-sm">
      <div className="app">
        <div className="main">
          <div className="th">
            <span style={{ width: 120 }}>Agent</span>
            <span style={{ width: 88 }}>Status</span>
            <span style={{ flex: 1 }}>Summary</span>
            <span style={{ width: 96 }} className="mock-hide-sm">Model</span>
            <span style={{ width: 60 }}>Took</span>
            <span style={{ width: 56, textAlign: "right" }}>Cost</span>
          </div>
          {runs.map((r, i) => {
            const a = agents.find((x) => x.id === r.agentId)!;
            return (
              <div key={r.id} className={"tr tr-sm" + (i % 2 ? " tr-alt" : "")}>
                <span style={{ width: 120, display: "flex", gap: 6, alignItems: "center" }} className="cell"><Avatar agent={a} size={18} />{a.name}<span style={{ color: "var(--ink-5)", fontSize: 11 }}>{triggerLabel(r.trigger)}</span></span>
                <span style={{ width: 88 }}><RunPill status={r.status} /></span>
                <span style={{ flex: 1 }} className="cell">{r.summary}</span>
                <span style={{ width: 96 }} className="cell mock-hide-sm"><Pill mono>{modelLabel(r.model)}</Pill></span>
                <span style={{ width: 60 }} className="mono" >{dur(r.startedAt, r.finishedAt)}</span>
                <span style={{ width: 56, textAlign: "right" }}><Money v={r.costUsd} /></span>
              </div>
            );
          })}
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
          <div className="pane-h"><Ic.Shield size={13} />Permissions<span className="grow" /><span style={{ fontWeight: 400, color: "var(--ink-4)" }}>Kai · checked by the app before every tool call</span></div>
          {rules.map((r) => (
            <div key={r.pattern} className="rule" style={{ background: "var(--surface)" }}>
              <span className="mono" style={{ flex: 1, fontSize: 11.5 }}>{r.pattern}</span>
              <span style={{ color: "var(--ink-4)" }} className="mock-hide-sm">{r.label}</span>
              <span className="pop" style={{ background: style[r.behavior].bg, color: style[r.behavior].ink, borderColor: "transparent", width: 64, justifyContent: "space-between" }}>{r.behavior}<Ic.UpDown size={9} /></span>
            </div>
          ))}
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
