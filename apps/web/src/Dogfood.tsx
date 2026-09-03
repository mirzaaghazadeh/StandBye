// "Standbye builds Standbye": the app is maintained by a Standbye team running on this repository.
// The log is the repo's real git history, snapshotted by scripts/fetch-commits.mjs.
import { Pill } from "@kit/kit";
import snapshot from "./commits.json";

export function Dogfood() {
  return (
    <section id="dogfood" className="dog">
      <div className="wrap wrap-wide">
        <div className="dog-head">
          <div className="eyebrow" style={{ marginBottom: 12 }}><Pill bg="rgba(46,155,95,0.25)" ink="#8fd7ab"><span className="dot" style={{ background: "#2e9b5f" }} />Running on this repo right now</Pill></div>
          <h2>This app is built by a team running inside this app.</h2>
          <p className="muted" style={{ fontSize: 17 }}>
            Standbye's own code is maintained by a Standbye team: a lead, an engineer, a reviewer and a docs writer, around the clock, on the same guardrails you get.
            They plan, ship, review and document. The owner answers questions in the inbox. What you're downloading is what they made.
          </p>
          <div className="dog-stats">
            <div className="dog-stat"><b>{snapshot.count}</b><span>commits on main</span></div>
            <div className="dog-stat"><b>4</b><span>agents on the team</span></div>
            <div className="dog-stat"><b>3</b><span>standing schedules: standup, report, retro</span></div>
            <div className="dog-stat"><b>1</b><span>human, answering the inbox</span></div>
          </div>
        </div>
        <div className="dog-log">
          {snapshot.commits.slice(0, 10).map((c) => (
            <div key={c.hash}><span className="when">{c.date.slice(5)}</span><span className="mono">{c.hash}</span><span className="txt">{c.subject}</span></div>
          ))}
        </div>
        <div className="fine" style={{ textAlign: "center", marginTop: 16 }}>
          Real git log of this repository as of {snapshot.fetchedAt}. If something in the app looks half-finished, that's the team mid-sprint.
        </div>
      </div>
    </section>
  );
}
