// /download/: every platform in one place. macOS ships today; the rest is labelled honestly as coming.
import { Ic } from "@kit/icons";
import { Avatar, Button, KindPill, Pill, Progress, Switch, ago } from "@kit/kit";
import desktopPkg from "@desktop-pkg";
import { DOWNLOAD, GITHUB, agents, questions, spentToday, team } from "./data";
import { Footer, Nav } from "./App";

const VERSION = desktopPkg.version;
const RELEASES = `${GITHUB}/releases`;
const NOTIFY = `${GITHUB}/subscription`;

type Platform = { name: string; icon: React.ReactNode; status: "available" | "soon"; blurb: string; files?: string[]; note: string };

const DESKTOP: Platform[] = [
  {
    name: "macOS", icon: <AppleIcon />, status: "available",
    blurb: "The full app: the team runs on your Mac, in the menu bar, on your keys.",
    files: [`Standbye-${VERSION}-arm64.dmg`, `Standbye-${VERSION}-arm64-mac.zip`],
    note: "Apple silicon. macOS 13 or newer, and Node 22 on the machine (Homebrew, nvm or the official installer).",
  },
  { name: "Windows", icon: <WindowsIcon />, status: "soon", blurb: "Same app, same supervisor, on Windows 11.", note: "The supervisor is plain Node and already runs there; the installer and the tray UI are what's left." },
  { name: "Linux", icon: <LinuxIcon />, status: "soon", blurb: "AppImage and deb for the machines that never sleep.", note: "Headless mode first, so a team can live on a server and you drive it from the phone app." },
];

export function DownloadPage() {
  return (
    <>
      <Nav />
      <main>
        <section className="hero hero-dl">
          <div className="wrap">
            <div className="eyebrow"><Pill bg="var(--accent-soft)" ink="var(--accent-dark)">Free · open source</Pill><Pill>Version {VERSION}</Pill></div>
            <h1>Get Standbye</h1>
            <p className="lede">One download for your Mac today. The other platforms, and the phone app for running the team from wherever you are, are on the way.</p>
          </div>
        </section>

        <section className="sec-block" style={{ paddingTop: 0 }}>
          <div className="wrap wrap-wide">
            <div className="plats">
              {DESKTOP.map((p) => (
                <div key={p.name} className={"card plat" + (p.status === "soon" ? " plat-soon" : "")}>
                  <div className="plat-h">
                    <span className="plat-i">{p.icon}</span>
                    <div className="plat-n">{p.name}</div>
                    {p.status === "available" ? <Pill bg="var(--green-bg)" ink="var(--green-ink)">Available</Pill> : <Pill bg="var(--amber-bg)" ink="var(--amber-ink)">Coming soon</Pill>}
                  </div>
                  <p>{p.blurb}</p>
                  {p.status === "available" ? (
                    <>
                      <a className="btn btn-primary btn-xl plat-btn" href={DOWNLOAD}><Ic.File size={14} />Download for macOS</a>
                      <div className="plat-files">
                        {p.files?.map((f) => <a key={f} className="mono" href={`${GITHUB}/releases/latest/download/${f}`}>{f}</a>)}
                        <a href={RELEASES}>All releases and notes</a>
                      </div>
                    </>
                  ) : (
                    <a className="btn btn-xl plat-btn" href={NOTIFY} target="_blank" rel="noreferrer"><Ic.Clock size={14} />Watch releases on GitHub</a>
                  )}
                  <div className="fine">{p.note}</div>
                </div>
              ))}
            </div>
            <div className="dl-steps card">
              <div className="dl-step"><span className="step-i">1</span><div><b>Open the .dmg</b> and drag Standbye to Applications. The build is not notarized yet, so the first launch is right-click, Open.</div></div>
              <div className="dl-step"><span className="step-i">2</span><div><b>Connect a provider.</b> Your Claude Code login is picked up on its own. Otherwise paste an Anthropic or OpenRouter key.</div></div>
              <div className="dl-step"><span className="step-i">3</span><div><b>Describe the team</b> or start from the built-in one, point it at a repo, set the daily cap. They start on the next heartbeat.</div></div>
            </div>
          </div>
        </section>

        <section id="mobile" className="sec-block alt-bg">
          <div className="wrap wrap-wide">
            <div className="two two-rev">
              <div>
                <div className="eyebrow" style={{ marginBottom: 10 }}><Pill bg="var(--amber-bg)" ink="var(--amber-ink)">Coming soon</Pill><Pill>iOS · Android</Pill></div>
                <h2 style={{ marginTop: 0 }}>Manage the team from anywhere</h2>
                <p className="muted">Your Mac keeps running the team. Your phone is where you answer it. The companion app talks to your own supervisor over an encrypted tunnel, so nothing about your repo or your keys goes through us.</p>
                <ul className="checks">
                  <li><b>The inbox in your pocket.</b> Questions, approvals and hire proposals with the recommended answer one tap away.</li>
                  <li><b>A push when someone needs you.</b> Only for things that are yours to decide, with the deadline and the default that applies if you don't.</li>
                  <li><b>Pause, resume, cap.</b> Stop the whole team from the beach. Raise or lower today's budget. Wake an agent with a note.</li>
                  <li><b>Read the channels.</b> Standup plans, end-of-day reports and every run's cost, live.</li>
                </ul>
                <div className="stores">
                  <span className="store store-off"><AppleIcon /><span><small>Coming soon on the</small>App Store</span></span>
                  <span className="store store-off"><PlayIcon /><span><small>Coming soon on</small>Google Play</span></span>
                </div>
                <div className="fine">Want it sooner? <a href={`${GITHUB}/issues`} target="_blank" rel="noreferrer">Tell us what you'd use it for.</a></div>
              </div>
              <PhoneMock />
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}

/** The inbox, phone-sized, from the same kit: what the companion app is for. */
function PhoneMock() {
  const open = questions.filter((q) => q.status === "open");
  const first = open[0]!;
  const from = agents.find((a) => a.id === first.fromAgentId)!;
  return (
    <div className="phone-wrap">
      <div className="phone">
        <div className="phone-notch" />
        <div className="phone-top">
          <span className="phone-time mono">9:41</span>
          <span className="phone-title">{team.name}</span>
          <span className="dot dot-lg" style={{ background: "var(--green)" }} />
        </div>
        <div className="phone-body">
          <div className="phone-card phone-spend">
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span>Today</span>
              <span className="mono">${spentToday.toFixed(2)} / ${team.dailyCapUsd}</span>
            </div>
            <Progress value={spentToday} max={team.dailyCapUsd} height={4} />
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, marginTop: 8 }}>
              <span className="grow">Team running · {agents.filter((a) => a.status === "working").length} working</span>
              <Switch on onChange={() => undefined} />
            </div>
          </div>
          <div className="li-sec" style={{ background: "transparent", border: "none", padding: "8px 4px 4px" }}>NEEDS YOU · {open.filter((q) => q.kind !== "report").length}</div>
          <div className="phone-card phone-q">
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <Avatar agent={from} size={22} />
              <span style={{ fontWeight: 500, fontSize: 12 }}>{from.name}</span>
              <KindPill kind={first.kind} />
              <span className="fine" style={{ marginLeft: "auto" }}>{ago(first.createdAt)}</span>
            </div>
            <div style={{ fontWeight: 600, fontSize: 13, margin: "8px 0 4px" }}>{first.title}</div>
            <div className="fine" style={{ lineHeight: 1.45 }}>{first.body.slice(0, 96)}…</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 10 }}>
              {first.options.slice(0, 2).map((o) => (
                <div key={o} className={"opt" + (o === first.recommended ? " opt-on" : "")} style={{ padding: "7px 10px", fontSize: 12 }}>
                  <span className={"rad" + (o === first.recommended ? " rad-on" : "")} />
                  <span style={{ flex: 1 }}>{o}</span>
                  {o === first.recommended && <Pill bg="var(--q-bg)" ink="var(--q-ink)">rec.</Pill>}
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
              <Button primary lg style={{ flex: 1 }}>Answer</Button>
              <Button lg>Later</Button>
            </div>
          </div>
          {open.slice(1).map((q) => {
            const a = agents.find((x) => x.id === q.fromAgentId)!;
            return (
              <div key={q.id} className="phone-card phone-row">
                <Avatar agent={a} size={20} />
                <span className="cell" style={{ flex: 1, fontSize: 12 }}>{q.title}</span>
                <KindPill kind={q.kind} />
              </div>
            );
          })}
        </div>
        <div className="phone-tabs">
          <span><Ic.Home size={16} /></span>
          <span className="phone-tab-on"><Ic.Inbox size={16} /><i className="badge">2</i></span>
          <span><Ic.Hash size={16} /></span>
          <span><Ic.Runs size={16} /></span>
        </div>
      </div>
    </div>
  );
}

function AppleIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M16.4 12.7c0-2.5 2-3.7 2.1-3.7-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9C6.1 7.1 4.5 8 3.6 9.6c-1.9 3.3-.5 8.1 1.4 10.8.9 1.3 2 2.8 3.4 2.7 1.4-.1 1.9-.9 3.5-.9s2.1.9 3.5.9c1.5 0 2.4-1.3 3.3-2.6 1-1.5 1.5-3 1.5-3.1-.1 0-2.8-1.1-2.8-4.7zM14 5.4c.7-.9 1.2-2.1 1.1-3.4-1.1 0-2.4.7-3.1 1.6-.7.8-1.3 2-1.1 3.3 1.2.1 2.4-.6 3.1-1.5z" /></svg>;
}
function WindowsIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M3 5.5l7.5-1v7H3v-6zm8.5-1.2L21 3v8.5h-9.5V4.3zM3 12.5h7.5v7L3 18.5v-6zm8.5 0H21V21l-9.5-1.3v-7.2z" /></svg>;
}
function LinuxIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 3c-2.5 0-4 2-4 4.5 0 1.5-.5 2.5-1.5 4S5 14.5 5 16.5c0 1 .5 1.5 1.5 1.5h11c1 0 1.5-.5 1.5-1.5 0-2-.5-3.5-1.5-5S16 9 16 7.5C16 5 14.5 3 12 3z" /><path d="M10 8h.01M14 8h.01M10.5 11h3l-1.5 1.5z" /><path d="M7 18l-1.5 2h4l1-2M17 18l1.5 2h-4l-1-2" /></svg>;
}
function PlayIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M4 3.5v17a.8.8 0 0 0 1.2.7L20 12.7a.8.8 0 0 0 0-1.4L5.2 2.8A.8.8 0 0 0 4 3.5z" /></svg>;
}
