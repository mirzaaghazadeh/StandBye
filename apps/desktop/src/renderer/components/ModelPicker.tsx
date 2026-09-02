import { useEffect, useMemo, useRef, useState } from "react";
import type { ModelInfo, Provider } from "@crew/shared";
import { store, useStore } from "../state/store";
import { Ic } from "../ui/icons";

const PROVIDER_LABEL: Record<Provider, string> = { anthropic: "Claude", openrouter: "OpenRouter" };

/**
 * Searchable model picker, grouped by the providers that are switched on and ready.
 * Looks like a popup button; opens a panel with a search field and the live catalog.
 */
export function ModelPicker({ value, provider, onChange, width = 190, small }: {
  value: string;
  provider: Provider;
  onChange: (model: string, provider: Provider) => void;
  width?: number;
  small?: boolean;
}) {
  const models = useStore((s) => s.models);
  const providers = useStore((s) => s.providers);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!models) void store.loadModels(); }, [models]);
  useEffect(() => {
    if (!open) return;
    setQ(""); setCursor(0);
    setTimeout(() => inputRef.current?.focus(), 0);
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const active = (["anthropic", "openrouter"] as Provider[]).filter((p) => providers?.[p].ready);
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
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(flat.length - 1, c + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); const m = flat[cursor]; if (m) pick(m); }
    else if (e.key === "Escape") setOpen(false);
  };

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block", width }}>
      <button className="pop" style={{ width: "100%", justifyContent: "space-between", height: small ? 20 : 22 }} onClick={() => setOpen((o) => !o)} title={value}>
        <span className="cell" style={{ minWidth: 0 }}>{current?.name ?? value}</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--ink-5)", fontSize: 10 }}>{PROVIDER_LABEL[provider]}<Ic.UpDown size={10} stroke="#5C5850" strokeWidth={3} /></span>
      </button>
      {open && (
        <div style={{ position: "absolute", top: "100%", left: 0, marginTop: 4, width: 360, maxHeight: 380, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, boxShadow: "0 10px 30px rgba(0,0,0,0.18)", zIndex: 50, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div className="search" style={{ margin: 8, width: "auto" }}>
            <Ic.Search size={13} />
            <input ref={inputRef} placeholder="Search models" value={q} onChange={(e) => { setQ(e.target.value); setCursor(0); }} onKeyDown={onKey} />
          </div>
          <div className="scroll" style={{ flex: 1, minHeight: 0, paddingBottom: 6 }}>
            {!models && <div style={{ padding: 12, fontSize: 12, color: "var(--ink-4)" }}>Loading catalog…</div>}
            {models && active.length === 0 && <div style={{ padding: 12, fontSize: 12, color: "var(--ink-4)" }}>No provider is ready. Turn one on in Settings.</div>}
            {models && active.length > 0 && flat.length === 0 && <div style={{ padding: 12, fontSize: 12, color: "var(--ink-4)" }}>No model matches "{q}".</div>}
            {groups.map((g) => (
              <div key={g.provider}>
                <div className="li-sec" style={{ position: "sticky", top: 0, display: "flex", justifyContent: "space-between" }}>
                  <span>{PROVIDER_LABEL[g.provider]}</span>
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
                      <span style={{ textAlign: "right", flexShrink: 0 }}>
                        <span className="mono" style={{ display: "block", fontSize: 10.5, color: "var(--ink-3)" }}>{price(m)}</span>
                        <span style={{ display: "block", fontSize: 10, color: "var(--ink-5)" }}>{m.context ? `${Math.round(m.context / 1000)}k ctx` : ""}{m.tags.length ? ` · ${m.tags.slice(0, 2).join(", ")}` : ""}</span>
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
      )}
    </div>
  );
}

export function price(m: ModelInfo): string {
  if (m.inputPerM === null && m.outputPerM === null) return "price n/a";
  if (m.inputPerM === 0 && m.outputPerM === 0) return "free";
  const f = (v: number | null) => (v === null ? "?" : v >= 10 ? `$${v.toFixed(0)}` : v >= 1 ? `$${v.toFixed(1)}` : `$${v.toFixed(2)}`);
  return `${f(m.inputPerM)} / ${f(m.outputPerM)}`;
}
