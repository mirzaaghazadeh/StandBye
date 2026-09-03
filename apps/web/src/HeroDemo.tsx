// The hero window: the same app, a different team every few seconds, crossfaded.
import { useEffect, useState } from "react";
import { HomeMock } from "./Mock";
import { demoTeams } from "./teams";

/** How long each team stays on screen. One constant, in milliseconds. */
export const HERO_INTERVAL_MS = 1600;
const FADE_MS = 450;

export function HeroDemo() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  // Two stacked layers so the outgoing team fades while the incoming one appears.
  const [layers, setLayers] = useState<{ a: number; b: number; front: "a" | "b" }>({ a: 0, b: 1, front: "a" });

  useEffect(() => {
    if (paused) return;
    const t = window.setInterval(() => setIndex((i) => (i + 1) % demoTeams.length), HERO_INTERVAL_MS);
    return () => window.clearInterval(t);
  }, [paused]);

  useEffect(() => {
    setLayers((l) => (l.front === "a" ? { ...l, b: index, front: "b" } : { ...l, a: index, front: "a" }));
  }, [index]);

  const go = (i: number) => { setIndex(i); };

  return (
    <div className="hero-demo" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
      <div className="hero-stack">
        <div className={"hero-layer" + (layers.front === "a" ? " hero-layer-on" : "")} style={{ transitionDuration: `${FADE_MS}ms` }} aria-hidden={layers.front !== "a"}>
          <HomeMock demo={demoTeams[layers.a]} />
        </div>
        <div className={"hero-layer" + (layers.front === "b" ? " hero-layer-on" : "")} style={{ transitionDuration: `${FADE_MS}ms` }} aria-hidden={layers.front !== "b"}>
          <HomeMock demo={demoTeams[layers.b]} />
        </div>
      </div>
      <div className="hero-teams" role="tablist" aria-label="Example teams">
        {demoTeams.map((t, i) => (
          <button key={t.id} role="tab" aria-selected={i === index} className={"hero-team" + (i === index ? " hero-team-on" : "")} onClick={() => go(i)} title={t.tagline}>
            {t.name}
          </button>
        ))}
      </div>
      <div className="hero-tag">{demoTeams[index]?.tagline}</div>
    </div>
  );
}
