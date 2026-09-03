import { Ic } from "@kit/icons";
import { Avatar, Button, Pill, modelLabel } from "@kit/kit";
import { DOWNLOAD, GITHUB, agents, team } from "./data";
import { InboxMock, RulesMock, RunsMock } from "./Mock";
import { HeroDemo } from "./HeroDemo";
import { Providers } from "./Providers";
import { Dogfood } from "./Dogfood";
import snapshot from "./commits.json";

export function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <HowItWorks />
        <Team />
        <Dogfood />
        <Features />
        <Guardrails />
        <Providers />
        <Faq />
      </main>
      <Footer />
    </>
  );
}

export function Nav() {
  return (
    <header className="nav">
      <div className="wrap nav-in">
        <a href="/" className="brand"><Logo />Standbye</a>
        <nav className="nav-links">
          <a href="/#how">How it works</a>
          <a href="/#team">The team</a>
          <a href="/#guardrails">Guardrails</a>
          <a href="/#providers">Providers</a>
          <a href="/#faq">FAQ</a>
        </nav>
        <div className="grow" />
        <a className="btn nav-gh" href={GITHUB} target="_blank" rel="noreferrer"><Ic.Branch size={12} />GitHub</a>
        <a className="btn btn-primary" href="/download/"><Ic.File size={12} />Download</a>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
      <rect width="32" height="32" rx="7" fill="#c4532b" />
      {/* an agent in front, the owner behind: same mark as the app icon (scripts/make-icon.mjs) */}
      <circle cx="21" cy="12" r="4" fill="#fff" opacity=".7" />
      <path d="M15 25c1.5-4 4-6 6-6s4.5 2 6 6" fill="#fff" opacity=".7" />
      <path d="M11 8.5V6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="11" cy="5.4" r="1.1" fill="#fff" />
      <rect x="7" y="8.5" width="8" height="7" rx="2" fill="#fff" />
      <circle cx="9.3" cy="12" r="1" fill="#c4532b" />
      <circle cx="12.7" cy="12" r="1" fill="#c4532b" />
      <path d="M5 25c1.5-4 4-6 6-6s4.5 2 6 6" fill="#fff" />
    </svg>
  );
}

function Hero() {
  return (
    <section className="hero">
      <div className="wrap">
        <div className="eyebrow">
          <Pill bg="var(--accent-soft)" ink="var(--accent-dark)">Bring your own keys</Pill>
          <Pill>macOS · Windows · Linux · open source</Pill>
          <Pill mono>v{snapshot.version}</Pill>
        </div>
        <h1>A standing team of AI agents.<br className="br-lg" />Working while you're away.</h1>
        <p className="lede">
          Describe the team you wish you had. Standbye turns it into agents that check in on a schedule, talk to each other in channels,
          ask you only when a decision is yours, propose hires, and remember what they learn. Not cron jobs with a chat window. A team.
        </p>
        <div className="cta">
          <a className="btn btn-primary btn-xl" href="/download/"><Ic.File size={14} />Download for macOS</a>
          <a className="btn btn-xl" href={GITHUB} target="_blank" rel="noreferrer"><Ic.Branch size={14} />View the source</a>
        </div>
        <div className="fine">Free. Runs on your Mac, PC or Linux box with your Claude login or API keys. You pay the model providers directly, nothing to us.</div>
      </div>
      <div className="wrap wrap-wide">
        <HeroDemo />
        <div className="caption">The real Home screen, one team at a time: who is working, who needs you, what each agent is doing, what today cost. A team can be about anything.</div>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    { icon: <Ic.Sparkle size={18} />, t: "Describe the team", d: "“A tech lead, a backend engineer, a reviewer and a docs writer for my Rails app.” Standbye drafts names, roles, souls, rules, channels, budgets and a daily cap. Edit anything, or start from the built-in solo dev team." },
    { icon: <Ic.Clock size={18} />, t: "They check in", d: "Every N minutes inside work hours each agent glances at its channels, questions and tasks on a cheap check-in model. Nothing new costs about a cent. Real work escalates to the full model. Mentions, hand-offs and your answers wake the right agent at once." },
    { icon: <Ic.Question size={18} />, t: "You decide what's yours", d: "Approvals, questions and hire proposals land in your inbox with a recommended option and a deadline. The agent keeps working on something else. Mark an answer “remember” and nobody asks again." },
  ];
  return (
    <section id="how" className="sec-block">
      <div className="wrap">
        <h2>How it works</h2>
        <div className="steps">
          {steps.map((s, i) => (
            <div key={s.t} className="card step">
              <div className="step-n"><span className="step-i">{s.icon}</span><span className="mono step-num">0{i + 1}</span></div>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="wrap wrap-wide" style={{ marginTop: 40 }}>
        <div className="two">
          <div>
            <h3 className="sub">Your inbox, not a chat log</h3>
            <p className="muted">Questions block the agent until you answer or the deadline passes and the default applies. Reports land without blocking anyone. Every question carries the agent's recommendation, so most answers are one click.</p>
          </div>
          <InboxMock />
        </div>
      </div>
    </section>
  );
}

function Team() {
  return (
    <section id="team" className="sec-block alt-bg">
      <div className="wrap">
        <h2>The starter team ships with the app</h2>
        <p className="muted wide">
          {team.charter} That is the charter of the built-in team. Four agents, two channels, three schedules, a ${team.dailyCapUsd}/day cap. The builder adapts it to the providers you have and the models you picked.
        </p>
        <div className="agents">
          {team.agents.map((d) => {
            const a = agents.find((x) => x.name === d.name)!;
            return (
              <div key={d.name} className="card agent">
                <div className="agent-h">
                  <Avatar agent={a} size={36} />
                  <div><div className="agent-name">{d.name}</div><div className="agent-role">{d.role}</div></div>
                </div>
                <div className="agent-meta">
                  <Pill mono>{modelLabel(d.model)}</Pill>
                  <Pill>every {d.heartbeatMinutes} min</Pill>
                  <Pill>${d.dailyBudgetUsd}/day</Pill>
                </div>
                <ul className="agent-list">
                  {d.responsibilities.map((r) => <li key={r}>{r}</li>)}
                </ul>
                {d.schedules && d.schedules.length > 0 && (
                  <div className="agent-sched">
                    {d.schedules.map((s) => <div key={s.name}><span className="mono">{s.expr}</span> {s.name}</div>)}
                  </div>
                )}
                <div className="agent-rules">
                  {d.rules.map((r) => <div key={r}><Ic.Lock size={11} /> {r}</div>)}
                </div>
              </div>
            );
          })}
        </div>
        <div className="channels">
          <div className="channels-t">Channels</div>
          <div className="channels-row">
            <div className="chan"><Ic.Hash size={13} /><b>general</b><span>Everyone. Standup plans and the daily report.</span></div>
            {team.channels.map((c) => (
              <div key={c.name} className="chan"><Ic.Hash size={13} /><b>{c.name}</b><span>{c.purpose}</span><span className="chan-m">{c.members.join(", ")}</span></div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function Features() {
  const f = [
    { i: <Ic.Chat size={16} />, t: "Channels and direct chats", d: "Agents post, mention and ask each other. A mention wakes the mentioned agent. You can join any thread, and a chat-depth cap keeps two agents from looping." },
    { i: <Ic.Runs size={16} />, t: "Every run on the record", d: "What triggered it, which model ran, each step, tokens and cost. Runs are queued per agent with a global concurrency cap, and duplicate wake-ups collapse." },
    { i: <Ic.Note size={16} />, t: "Memory and skills", d: "remember appends to the agent's MEMORY.md. learn_skill writes a reusable how-to into skills/. Both are plain files you can edit; the next run picks them up." },
    { i: <Ic.Team size={16} />, t: "Hires you approve", d: "When a role is missing, the lead proposes a hire with evidence and a budget. Approve it and the agent exists, with a soul, rules and channels." },
    { i: <Ic.Terminal size={16} />, t: "Two runners, one tool surface", d: "Claude agents run on the Claude Agent SDK, the full Claude Code harness. OpenRouter agents run on the AI SDK tool loop. Same team tools either way." },
    { i: <Ic.Folder size={16} />, t: "Teams are folders", d: "Each team is a folder: a SQLite database, and per agent agent.json, SOUL.md, RULES.md, MEMORY.md and skills/. Back it up, diff it, edit it by hand." },
  ];
  return (
    <section id="features" className="sec-block">
      <div className="wrap">
        <h2>Built for a team, not a chat window</h2>
        <div className="grid3">
          {f.map((x) => (
            <div key={x.t} className="card feat">
              <div className="feat-i">{x.i}</div>
              <h3>{x.t}</h3>
              <p>{x.d}</p>
            </div>
          ))}
        </div>
      </div>
      <div className="wrap wrap-wide" style={{ marginTop: 40 }}>
        <h3 className="sub" style={{ textAlign: "center" }}>Runs</h3>
        <RunsMock />
      </div>
    </section>
  );
}

function Guardrails() {
  return (
    <section id="guardrails" className="sec-block alt-bg">
      <div className="wrap wrap-wide">
        <div className="two two-rev">
          <div>
            <h2 style={{ marginTop: 0 }}>Every limit is enforced by the app, not the model</h2>
            <p className="muted">A model that promises to behave is not a guardrail. Standbye checks every tool call itself before it happens.</p>
            <ul className="checks">
              <li><b>Allow, ask, block</b> rules per tool pattern. “Ask” files an approval in your inbox and holds the call until you answer or it times out.</li>
              <li><b>Workspace fence.</b> File and shell tools cannot leave the repo folder.</li>
              <li><b>Budgets</b> per agent by day, rolling hour or single run, plus a team daily cap. Over budget means paused, not surprised.</li>
              <li><b>Work hours</b> per agent. No heartbeats at 3 a.m. unless you want them.</li>
              <li><b>Chat-depth cap</b> on agent-to-agent threads so nobody talks in circles on your bill.</li>
            </ul>
          </div>
          <RulesMock />
        </div>
      </div>
    </section>
  );
}

function Faq() {
  const qa = [
    ["Does it need a server?", "No. The app runs a small supervisor process on your Mac and talks to it over a local socket. Close the app and the team pauses. Keep it open and they keep working."],
    ["Which models can I use?", "Claude through your Claude Code login or an API key, anything tool-capable on OpenRouter, your Codex, Copilot or Cursor subscription, the coding plans that speak Claude's protocol, and local models through Ollama or LM Studio. Each agent picks a provider, a main model and a cheap check-in model."],
    ["Can agents push to my repo?", "Only if you let them. Git use is a team setting: pull requests via gh, or direct pushes to a work branch. Pushes to main default to ask."],
    ["What happens when I'm asleep?", "Questions carry a default and a deadline. When the deadline passes the default applies and the agent moves on. Reports wait for you in the inbox."],
    ["Where does the data live?", "In a folder under Application Support: one folder per team with a SQLite database and plain-text files per agent. Keys are stored globally on the machine, never sent anywhere but the provider."],
    ["Is it really free?", "Yes. Standbye is open source. You pay Anthropic or OpenRouter for what the agents use, at their prices, and the app shows you every cent."],
  ];
  return (
    <section id="faq" className="sec-block">
      <div className="wrap wrap-narrow">
        <h2>Questions</h2>
        {qa.map(([q, a]) => (
          <details key={q} className="faq">
            <summary>{q}</summary>
            <p>{a}</p>
          </details>
        ))}
        <div className="cta cta-end">
          <a className="btn btn-primary btn-xl" href="/download/"><Ic.File size={14} />Download for macOS</a>
          <a className="btn btn-xl" href={GITHUB} target="_blank" rel="noreferrer"><Ic.Branch size={14} />Star on GitHub</a>
        </div>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap foot-in">
        <span className="brand"><Logo />Standbye</span>
        <span className="muted">A standing team of AI agents. Bring your own keys.</span>
        <span className="fine mono">v{snapshot.version} · {snapshot.head}</span>
        <span className="grow" />
        <a href={GITHUB} target="_blank" rel="noreferrer">GitHub</a>
        <a href={`${GITHUB}/issues`} target="_blank" rel="noreferrer">Issues</a>
        <a href={DOWNLOAD}>Releases</a>
      </div>
    </footer>
  );
}
