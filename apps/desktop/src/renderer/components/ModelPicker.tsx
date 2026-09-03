import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { PROVIDERS, providerLabel, providerSpec, type ModelInfo, type Provider } from "@crew/shared";
import { store, useStore } from "../state/store";
import { Ic } from "../ui/icons";

const PANEL_W = 360;
const PANEL_H = 380;

/**
 * Searchable model picker, grouped by the providers that are switched on and ready.
 * Looks like a popup button; the panel floats in a portal so it never clips or widens its container.
 */
export function ModelPicker({ value, provider, onChange, width = 190, small, only }: {
  value: string;
  provider: Provider;
  onChange: (model: string, provider: Provider) => void;
  width?: number;
  small?: boolean;
  /** Restrict the list to one provider (used for per-provider defaults) */
  only?: Provider;
}) {
  const models = useStore((s) => s.models);
  const providers = useStore((s) => s.providers);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; up: boolean }>({ top: 0, left: 0, up: false });
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!models) void store.loadModels(); }, [models]);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(8, Math.min(r.left, vw - PANEL_W - 8));
    const up = r.bottom + PANEL_H + 8 > vh && r.top - PANEL_H - 8 > 0;
    setPos({ top: up ? r.top - 4 : r.bottom + 4, left, up });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setQ(""); setCursor(0);
    setTimeout(() => inputRef.current?.focus(), 0);
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onScroll = () => setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onScroll);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); window.removeEventListener("resize", onScroll); };
  }, [open]);

  // Every provider that is ready, in catalog order — so switching an agent between Claude, a
  // coding plan and a model on this Mac is one list, not three screens.
  const active = PROVIDERS.map((p) => p.id).filter((p) => (only ? p === only : providers?.[p]?.ready));
  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return active.map((p) => ({
      provider: p,
      items: (models?.[p] ?? []).filter((m) => !needle || m.id.toLowerCase().includes(needle) || m.name.toLowerCase().includes(needle) || m.tags.some((t) => t.includes(needle))).slice(0, needle ? 40 : 60),
    })).filter((g) => g.items.length > 0);
  }, [active.join(","), models, q]);
  const flat = groups.flatMap((g) => g.items);
  const current = models?.[provider]?.find((m) => m.id === value);

  const pick = (m: ModelInfo) => { onChange(m.id, m.provider); setOpen(false); };
  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(flat.length - 1, c + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const m = flat[cursor]; if (m) pick(m); }
  };

  const panel = open ? (
    <div ref={panelRef} style={{
      position: "fixed", top: pos.up ? undefined : pos.top, bottom: pos.up ? window.innerHeight - pos.top : undefined, left: pos.left, width: PANEL_W, maxHeight: PANEL_H,
      background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 10px 30px rgba(0,0,0,0.18)", zIndex: 100, display: "flex", flexDirection: "column", overflow: "hidden",
    }}>
      <div className="search" style={{ margin: 8, width: "auto" }}>
        <Ic.Search size={13} />
        <input ref={inputRef} placeholder="Search models" value={q} onChange={(e) => { setQ(e.target.value); setCursor(0); }} onKeyDown={onInputKey} />
      </div>
      <div className="scroll" style={{ flex: 1, minHeight: 0, paddingBottom: 6, overflowX: "hidden" }}>
        {!models && <div style={{ padding: 12, fontSize: 12, color: "var(--ink-4)" }}>Loading catalog…</div>}
        {models && active.length === 0 && <div style={{ padding: 12, fontSize: 12, color: "var(--ink-4)" }}>{only ? "Catalog not loaded yet." : "No provider is ready. Turn one on in Settings."}</div>}
        {models && active.length > 0 && flat.length === 0 && <div style={{ padding: 12, fontSize: 12, color: "var(--ink-4)" }}>No model matches "{q}".</div>}
        {groups.map((g) => (
          <div key={g.provider}>
            <div className="li-sec" style={{ position: "sticky", top: 0, display: "flex", justifyContent: "space-between", zIndex: 1 }}>
              <span>{providerLabel(g.provider)}</span>
              <span style={{ fontWeight: 400 }}>{(models?.[g.provider] ?? []).length} models</span>
            </div>
            {g.items.map((m) => {
              const idx = flat.indexOf(m);
              const sel = m.id === value && m.provider === provider;
              return (
                <button key={m.id} className={"li" + (idx === cursor ? " li-sel" : "")} style={{ padding: "6px 12px", gap: 8, alignItems: "center" }} onMouseEnter={() => setCursor(idx)} onClick={() => pick(m)}>
                  <span style={{ width: 14, display: "inline-flex", justifyContent: "center", flexShrink: 0 }}>{sel && <Ic.Check size={12} stroke="var(--accent)" strokeWidth={3} />}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="cell" style={{ display: "block", fontWeight: sel ? 600 : 500 }}>{m.name}</span>
                    <span className="cell mono" style={{ display: "block", fontSize: 10.5, color: "var(--ink-5)" }}>{m.id}</span>
                  </span>
                  <span style={{ textAlign: "right", flexShrink: 0, maxWidth: 130 }}>
                    <span className="mono cell" style={{ display: "block", fontSize: 10.5, color: "var(--ink-3)" }}>{price(m)}</span>
                    <span className="cell" style={{ display: "block", fontSize: 10, color: "var(--ink-5)" }}>{m.context ? `${Math.round(m.context / 1000)}k ctx` : ""}{m.tags.length ? ` · ${m.tags.slice(0, 2).join(", ")}` : ""}</span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div style={{ borderTop: "1px solid var(--border-faint)", padding: "6px 12px", fontSize: 10.5, color: "var(--ink-5)", display: "flex", justifyContent: "space-between" }}>
        <span>Prices per million tokens, in / out</span>
        <a onClick={() => void store.loadModels(true)}>Refresh</a>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button ref={btnRef} className="pop" style={{ width, maxWidth: "100%", justifyContent: "space-between", height: small ? 20 : 22 }} onClick={() => setOpen((o) => !o)} title={value}>
        <span className="cell" style={{ minWidth: 0 }}>{current?.name ?? value}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--ink-5)", fontSize: 10, flexShrink: 0 }}>{providerLabel(provider)}<Ic.UpDown size={10} stroke="#5C5850" strokeWidth={3} /></span>
      </button>
      {panel && createPortal(panel, document.body)}
    </>
  );
}

export function price(m: ModelInfo): string {
  if (m.inputPerM === null && m.outputPerM === null) {
    // A coding plan or someone else's CLI is not billed per token, so "price n/a" reads as a
    // gap in our data when it is really the answer: it comes out of the subscription.
    const group = providerSpec(m.provider)?.group;
    return group === "plans" || group === "clis" ? "on your plan" : group === "local" ? "free" : "price n/a";
  }
  if (m.inputPerM === 0 && m.outputPerM === 0) return "free";
  const f = (v: number | null) => (v === null ? "?" : v >= 10 ? `$${v.toFixed(0)}` : v >= 1 ? `$${v.toFixed(1)}` : `$${v.toFixed(2)}`);
  return `${f(m.inputPerM)} / ${f(m.outputPerM)}`;
}
