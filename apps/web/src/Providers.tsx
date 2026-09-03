// "Bring what you already pay for": every provider, subscription and coding plan an agent can run on, as two
// auto-scrolling rows.
//
// The list itself is the app's own provider catalog (`@crew/shared`), imported straight from source the same
// way the mock windows import the real components — so the site cannot promise a provider the app does not
// ship, and a provider added to the app appears here on the next build. Only the artwork lives here: brand
// marks from the simple-icons package (CC0), and a monogram in the vendor's colour for the ones it does not
// carry, which is the same mark the app draws in its settings screen.
import { PROVIDERS, type ProviderSpec } from "@crew/shared";
import { ProviderMark } from "@kit/brand";
import snapshot from "./openrouter.json";

type Entry = { id: string; name: string; by: string; via: string; url: string };

/** A couple of lines read better on a marquee tile than in a settings pane. */
const VIA: Record<string, string> = {
  openrouter: `${snapshot.total} tool-capable models from ${snapshot.vendors.length} labs`,
};

function toEntry(p: ProviderSpec): Entry {
  return { id: p.id, name: p.name, by: p.by, via: VIA[p.id] ?? p.blurb, url: p.docsUrl };
}

// Row one: the logins and subscriptions you already have. Row two: coding plans, clouds, keys and local.
const ROW_A: Entry[] = PROVIDERS.filter((p) => p.group === "claude" || p.group === "clis").map(toEntry);
const ROW_B: Entry[] = PROVIDERS.filter((p) => p.group === "plans" || p.group === "clouds" || p.group === "local" || (p.group === "apis" && p.id !== "custom")).map(toEntry);

function Brand({ e }: { e: Entry }) {
  return <span className="pbrand"><ProviderMark id={e.id} size={18} variant="plain" /></span>;
}

function Row({ items, reverse }: { items: Entry[]; reverse?: boolean }) {
  // The track holds the list twice so the loop is seamless; the second copy is hidden from assistive tech.
  return (
    <div className={"marquee" + (reverse ? " marquee-rev" : "")}>
      <div className="marquee-track">
        {[0, 1].map((copy) => (
          <div key={copy} className="marquee-run" aria-hidden={copy === 1}>
            {items.map((e) => (
              <a key={e.name} className="ptile" href={e.url} target="_blank" rel="noreferrer" tabIndex={copy === 1 ? -1 : 0} title={e.via}>
                <Brand e={e} />
                <span className="ptile-t">
                  <span className="ptile-n">{e.name}</span>
                  <span className="ptile-v">{e.by} · {e.via}</span>
                </span>
              </a>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Providers() {
  const total = ROW_A.length + ROW_B.length;
  return (
    <section id="providers" className="sec-block alt-bg prov-band">
      <div className="wrap wrap-wide">
        <h2 style={{ textAlign: "center" }}>Bring what you already pay for</h2>
        <p className="muted" style={{ textAlign: "center", maxWidth: 720, margin: "0 auto 22px" }}>
          A ChatGPT plan, a Copilot seat, a Cursor subscription, a coding plan from one of the labs, a model on your own Mac. {total} ways in, one team,
          the same tools and guardrails whichever you pick.
        </p>
      </div>
      <Row items={ROW_A} />
      <Row items={ROW_B} reverse />
      <div className="wrap wrap-wide">
        <div className="fine" style={{ textAlign: "center", marginTop: 14 }}>
          Hover to pause. Brand marks belong to their owners. · <a href="/docs/openrouter/">Setting up OpenRouter</a>
        </div>
      </div>
    </section>
  );
}
