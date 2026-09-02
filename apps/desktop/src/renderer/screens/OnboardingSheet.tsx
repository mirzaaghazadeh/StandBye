import { useState } from "react";
import { store, useStore } from "../state/store";
import { Ic } from "../ui/icons";
import { Button } from "../ui/kit";
import { ProvidersPanel } from "../components/ProvidersPanel";

/**
 * First open: 1) turn on providers, 2) choose how to make the team.
 * Describe / Template hand off to the builder sheet; Build manually opens the manual sheet.
 */
export function OnboardingSheet() {
  const providers = useStore((s) => s.providers);
  const hasTeams = useStore((s) => s.teams.length > 0);
  const anyReady = Boolean(providers?.anthropic.ready || providers?.openrouter.ready);
  const [step, setStep] = useState<1 | 2>(hasTeams && anyReady ? 2 : 1);

  return (
    <div className="sheet" style={{ width: 680, height: 560 }}>
      <div className="sheet-h">
        <b>{hasTeams ? "New team" : "Welcome to Standbye"}</b>
        <span className="grow" />
        <Steps step={step} />
        {hasTeams && <button className="ibtn" onClick={() => store.closeSheet()}><Ic.X size={14} /></button>}
      </div>

      {step === 1 ? (
        <div className="sheet-body" style={{ flexDirection: "column", padding: "18px 24px", gap: 12, overflowY: "auto" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Which providers can your team use?</div>
            <div style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 2 }}>Bring your own keys. They are encrypted with the macOS keychain and only ever sent to the provider itself. You can mix providers inside one team.</div>
          </div>
          <ProvidersPanel />
        </div>
      ) : (
        <div className="sheet-body" style={{ flexDirection: "column", padding: "18px 24px", gap: 14 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>How do you want to make your team?</div>
            <div style={{ fontSize: 12, color: "var(--ink-4)", marginTop: 2 }}>Every team has its own workspace folder, channels and agents; every teammate is a folder with a soul, rules and a budget. You can change anything later.</div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, flex: 1 }}>
            <Choice icon={<Ic.Sparkle size={22} stroke="var(--accent)" />} title="Describe it" body="Say what you're building and what you need done. Your default model drafts the roles, souls, channels and budgets; you review before anything is created." action="Describe…" disabled={!anyReady} onClick={() => store.openSheet({ kind: "builder", mode: "describe" })} />
            <Choice icon={<Ic.Person size={22} stroke="var(--accent)" />} title="Build it myself" body="Add teammates one by one: name, role, model, budget. Start from role presets and edit the soul text as you like." action="Build…" onClick={() => store.openSheet({ kind: "manual" })} />
            <Choice icon={<Ic.Team size={22} stroke="var(--accent)" />} title="Start from a template" body="A solo dev team: a lead who plans and reports, a backend engineer, a reviewer and tester, and a docs writer." action="Use template…" onClick={() => store.openSheet({ kind: "builder", mode: "template" })} />
          </div>
        </div>
      )}

      <div className="sheet-f">
        {step === 2 && <Button lg onClick={() => setStep(1)}>Back</Button>}
        <span className="grow" />
        {step === 1 ? (
          <Button lg primary onClick={() => setStep(2)} disabled={!anyReady} title={anyReady ? undefined : "Turn on at least one provider"}>Continue</Button>
        ) : (
          <span style={{ fontSize: 12, color: "var(--ink-4)" }}>Pick one to continue</span>
        )}
      </div>
    </div>
  );
}

function Steps({ step }: { step: 1 | 2 }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink-4)" }}>
      <Dot n={1} on={step === 1} done={step > 1} /> Providers <span style={{ width: 16, height: 1, background: "var(--border)" }} /> <Dot n={2} on={step === 2} /> Team
    </span>
  );
}

function Dot({ n, on, done }: { n: number; on: boolean; done?: boolean }) {
  return (
    <span style={{ width: 18, height: 18, borderRadius: 999, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, background: on || done ? "var(--accent)" : "var(--border)", color: on || done ? "#fff" : "var(--ink-4)" }}>
      {done ? <Ic.Check size={10} stroke="#fff" strokeWidth={3.5} /> : n}
    </span>
  );
}

function Choice({ icon, title, body, action, onClick, disabled, note }: { icon: React.ReactNode; title: string; body: string; action: string; onClick: () => void; disabled?: boolean; note?: string }) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)", padding: 16, display: "flex", flexDirection: "column", gap: 8, opacity: disabled ? 0.6 : 1 }}>
      {icon}
      <div style={{ fontWeight: 600, fontSize: 14 }}>{title}</div>
      <div style={{ fontSize: 12, color: "var(--ink-3)", flex: 1, lineHeight: 1.45 }}>{body}</div>
      {note && <div style={{ fontSize: 11, color: "var(--q-ink)" }}>{note}</div>}
      <Button primary onClick={onClick} disabled={disabled}>{action}</Button>
    </div>
  );
}
