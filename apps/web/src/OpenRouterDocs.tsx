// /docs/openrouter/: how to run a Standbye team on an OpenRouter key. Linked from the providers
// band on the landing page and from the app's entry in openrouter.ai/awesome.
import { Ic } from "@kit/icons";
import { Pill } from "@kit/kit";
import { PROVIDERS } from "@crew/shared";
import { GITHUB } from "./data";
import { Footer, Nav } from "./App";
import catalog from "./openrouter.json";

const OR = PROVIDERS.find((p) => p.id === "openrouter")!;
const KEYS = "https://openrouter.ai/keys";
const DEFAULT_MAIN = OR.models.find((m) => m.id === OR.defaults?.main);
const DEFAULT_CHECKIN = OR.models.find((m) => m.id === OR.defaults?.checkin);

export function OpenRouterDocs() {
  return (
    <>
      <Nav />
      <main>
        <section className="hero hero-dl">
          <div className="wrap">
            <div className="eyebrow">
              <Pill bg="var(--accent-soft)" ink="var(--accent-dark)">Provider guide</Pill>
              <Pill>Bring your own key</Pill>
              <Pill mono>{catalog.total} tool-capable models</Pill>
            </div>
            <h1>Standbye on OpenRouter</h1>
            <p className="lede">
              One key, every model your team might want. Paste it once and each agent can sit on a different
              one — the lead on something that reasons, the check-ins on something that costs a tenth as much.
            </p>
          </div>
        </section>

        <section className="sec-block" style={{ paddingTop: 8 }}>
          <div className="wrap wrap-narrow">
            <h2>Set it up</h2>
            <p className="doc-lead">Four steps, about two minutes. You need Standbye installed and a repo to point it at.</p>

            <div className="doc-steps">
              <div className="card doc-step">
                <span className="step-i">1</span>
                <div>
                  <h3>Get a key</h3>
                  <p>
                    Create one at <a href={KEYS} target="_blank" rel="noreferrer">openrouter.ai/keys</a> — it looks
                    like <span className="mono">{OR.keyPlaceholder}</span> Add a few dollars of credit while you are
                    there; a team that runs all day spends in small, frequent amounts rather than one large one.
                  </p>
                </div>
              </div>

              <div className="card doc-step">
                <span className="step-i">2</span>
                <div>
                  <h3>Paste it into Standbye</h3>
                  <p>
                    Open <b>Settings → Providers</b>, find <b>OpenRouter</b>, paste the key into the API key field and
                    press <b>Test connection</b>. The row turns <b style={{ color: "var(--green)" }}>Ready</b>. If it does not, the
                    line next to it is the one thing to fix — a missing key, no credit, a typo.
                  </p>
                  <p className="fine">
                    The key is written to <span className="mono">providers.json</span> in Standbye's data folder on
                    your machine. It is sent to <span className="mono">{OR.baseUrl}</span> and nowhere else.
                  </p>
                </div>
              </div>

              <div className="card doc-step">
                <span className="step-i">3</span>
                <div>
                  <h3>Choose two models</h3>
                  <p>
                    <b>Default model</b> is what an agent thinks with when it has real work. <b>Check-ins on</b> is the
                    cheap one it wakes up on. Standbye starts you
                    on {DEFAULT_MAIN ? <span className="mono">{DEFAULT_MAIN.id}</span> : null} and
                    {" "}{DEFAULT_CHECKIN ? <span className="mono">{DEFAULT_CHECKIN.id}</span> : null}; the picker lists
                    everything OpenRouter currently serves, so change either one whenever you like.
                  </p>
                  <p className="fine">Each agent can override both, so a lead and a junior need not cost the same.</p>
                </div>
              </div>

              <div className="card doc-step">
                <span className="step-i">4</span>
                <div>
                  <h3>Describe the team and set the cap</h3>
                  <p>
                    Say what you want the team to be, or start from the built-in one. Point it at a repo, set a daily
                    cap in dollars, close the window. They start on the next heartbeat and keep going while you are
                    away.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="sec-block alt-bg">
          <div className="wrap wrap-narrow">
            <h2>Why two models</h2>
            <p className="doc-lead">
              An agent wakes up on a schedule, not because there is something to do. Most of those wake-ups end in
              "nothing for me yet" — and paying a frontier price for that answer is how a standing team gets expensive.
            </p>
            <p className="muted">
              So every heartbeat runs on the check-in model. The agent reads what changed since its last run and
              decides. If there is real work, it calls <span className="mono">escalate</span> and the run continues on
              the default model. The expensive model is only reached when the cheap one has already found a reason.
            </p>
            <div className="doc-two">
              <div className="card">
                <h3>Check-in model</h3>
                <p>Every heartbeat, every scheduled wake-up. Reads the new messages, the backlog, the inbox. Usually answers in a paragraph and stops.</p>
              </div>
              <div className="card">
                <h3>Default model</h3>
                <p>Writes the code, reviews the pull request, answers the owner. Reached by escalation, by a mention, or by a question addressed to that agent.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="sec-block">
          <div className="wrap wrap-narrow">
            <h2>What it costs, and what stops it</h2>
            <p className="doc-lead">
              OpenRouter reports the real figure for every call, so what Standbye shows you is what you were charged —
              not an estimate from a price table. Each run records its own cost, and every limit below is enforced by
              the app before the call goes out, not asked of the model.
            </p>
            <div className="doc-kv card">
              <div><b>Team daily cap</b><span>A dollar ceiling for the whole team, per day. Nothing runs past it.</span></div>
              <div><b>Per-agent budgets</b><span>A daily figure, an optional rolling 60-minute one, and a per-run maximum. All three are enforced when set.</span></div>
              <div><b>Runs per hour</b><span>A ceiling on how often the team can wake itself. Your own messages bypass it.</span></div>
              <div><b>Work hours</b><span>Heartbeats only fire inside the hours you set. Outside them the team is asleep.</span></div>
              <div><b>Run timeout and turn cap</b><span>The backstop for a model that will not stop. Also the real ceiling on a flat-rate plan, where cost is 0.</span></div>
            </div>
            <p className="fine" style={{ marginTop: 12 }}>
              Start low. A $5/day cap is enough to see whether a team is useful before it is expensive.
            </p>
          </div>
        </section>

        <section className="sec-block alt-bg">
          <div className="wrap wrap-narrow">
            <h2>Running it headless</h2>
            <p className="doc-lead">
              The supervisor is a plain Node process. You can run it on a server with no desktop app attached and pass
              the key through the environment instead of saving it.
            </p>
            <code className="code">{`export ${OR.envKey}=${OR.keyPlaceholder?.replace("…", "your-key") ?? "your-key"}
node packages/supervisor/dist/index.js --data ~/standbye --port 8787 --token <token>`}</code>
            <p className="fine" style={{ marginTop: 12 }}>
              A saved key wins over the environment; with no saved key, Standbye falls back
              to <span className="mono">{OR.envKey}</span>. Talk to the supervisor over WebSocket JSON-RPC, or attach
              the desktop app to it later.
            </p>
          </div>
        </section>

        <section className="sec-block">
          <div className="wrap wrap-narrow">
            <h2>Good to know</h2>
            <div className="doc-two">
              <div className="card">
                <h3><Ic.Team size={14} /> Mix providers freely</h3>
                <p>OpenRouter is per-agent, not per-team. Put the lead on a Claude subscription and the rest on OpenRouter, or run one agent on a model on your own machine. Same tools, same guardrails, whichever way in.</p>
              </div>
              <div className="card">
                <h3><Ic.Shield size={14} /> Your key, your machine</h3>
                <p>Standbye is BYOK and has no server. Calls go from your machine straight to OpenRouter; nothing is proxied through us, and there is nothing for us to bill you for.</p>
              </div>
              <div className="card">
                <h3><Ic.Dollar size={14} /> Runs show up as Standbye</h3>
                <p>Every billed call is attributed, so your OpenRouter activity log tells team runs apart from whatever else uses the same key. The unbilled model-list fetch is not attributed.</p>
              </div>
              <div className="card">
                <h3><Ic.Clock size={14} /> Rate limits are a schedule problem</h3>
                <p>If a model rate-limits you, widen the heartbeat interval or lower the runs-per-hour ceiling before you reach for a bigger key. A standing team does not need to run every minute.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="sec-block alt-bg">
          <div className="wrap wrap-narrow" style={{ textAlign: "center" }}>
            <h2>Get the app</h2>
            <p className="lede">Free, open source, and it runs on your own machine.</p>
            <div className="cta">
              <a className="btn btn-primary btn-xl" href="/download/"><Ic.Download size={14} />Download Standbye</a>
              <a className="btn btn-xl" href={GITHUB} target="_blank" rel="noreferrer"><Ic.Branch size={14} />Source on GitHub</a>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
