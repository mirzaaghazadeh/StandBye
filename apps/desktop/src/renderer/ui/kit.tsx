import type { Agent, AgentStatus, QuestionKind, RunStatus } from "@crew/shared";
import type { ReactNode } from "react";
import { Ic } from "./icons";

// ---------- avatars ----------

export function Avatar({ agent, size = 24, name, color, ink }: { agent?: Agent; size?: number; name?: string; color?: string; ink?: string }) {
  const label = (agent?.name ?? name ?? "?").charAt(0).toUpperCase();
  const bg = agent?.color ?? color ?? "#efede8";
  return (
    <span className="av" style={{ width: size, height: size, fontSize: Math.round(size * 0.45), background: bg, color: ink ?? inkFor(bg) }}>
      {label}
    </span>
  );
}

function inkFor(bg: string): string {
  const map: Record<string, string> = { "#e9d9cf": "#7a3a22", "#d7e3da": "#1f4d33", "#dddce8": "#3b3a6b", "#efede8": "#8c887f", "#1d1c1a": "#f5f4f1" };
  return map[bg.toLowerCase()] ?? "#3b3a3a";
}

export function UserAvatar({ size = 24 }: { size?: number }) {
  return <Avatar name="N" size={size} color="#1d1c1a" ink="#f5f4f1" />;
}

// ---------- status ----------

export const STATUS_COLOR: Record<AgentStatus, string> = {
  working: "var(--green)", needs_you: "var(--amber)", idle: "var(--ink-6)", paused: "var(--ink-6)", failed: "#c0392b", over_budget: "var(--amber)",
};

export function StatusDot({ status, size = 8 }: { status: AgentStatus; size?: number }) {
  return <span className="dot" style={{ width: size, height: size, background: STATUS_COLOR[status] }} />;
}

export function StatusPill({ status }: { status: AgentStatus }) {
  const label: Record<AgentStatus, string> = { working: "Working", needs_you: "Needs you", idle: "Idle", paused: "Paused", failed: "Failed", over_budget: "Over budget" };
  const style: Record<AgentStatus, { bg: string; ink: string }> = {
    working: { bg: "var(--green-bg)", ink: "var(--green-ink)" }, needs_you: { bg: "var(--amber-bg)", ink: "var(--amber-ink)" },
    idle: { bg: "#efede8", ink: "var(--ink-4)" }, paused: { bg: "#efede8", ink: "var(--ink-3)" }, failed: { bg: "var(--red-bg)", ink: "var(--red-ink)" },
    over_budget: { bg: "var(--amber-bg)", ink: "var(--amber-ink)" },
  };
  return (
    <span className="pill" style={{ background: style[status].bg, color: style[status].ink }}>
      <StatusDot status={status} size={6} />
      {label[status]}
    </span>
  );
}

export function RunPill({ status }: { status: RunStatus }) {
  const s: Record<RunStatus, { l: string; bg: string; ink: string }> = {
    queued: { l: "Queued", bg: "#efede8", ink: "var(--ink-4)" }, running: { l: "Running", bg: "var(--green-bg)", ink: "var(--green-ink)" },
    done: { l: "Done", bg: "#efede8", ink: "var(--ink-3)" }, failed: { l: "Failed", bg: "var(--red-bg)", ink: "var(--red-ink)" },
    needs_you: { l: "Needs you", bg: "var(--amber-bg)", ink: "var(--amber-ink)" }, noop: { l: "No-op", bg: "#efede8", ink: "var(--ink-5)" },
    cancelled: { l: "Cancelled", bg: "#efede8", ink: "var(--ink-5)" },
  };
  return <span className="pill" style={{ background: s[status].bg, color: s[status].ink }}>{s[status].l}</span>;
}

export function KindPill({ kind }: { kind: QuestionKind }) {
  const s: Record<QuestionKind, { l: string; bg: string; ink: string }> = {
    question: { l: "Question", bg: "var(--q-bg)", ink: "var(--q-ink)" }, approval: { l: "Approval", bg: "var(--red-bg)", ink: "var(--red-ink)" },
    hire: { l: "Hire", bg: "var(--blue-bg)", ink: "var(--blue-ink)" }, report: { l: "Report", bg: "#efede8", ink: "var(--ink-3)" },
  };
  return <span className="pill" style={{ background: s[kind].bg, color: s[kind].ink }}>{s[kind].l}</span>;
}

export function Pill({ children, bg = "#efede8", ink = "var(--ink-3)", mono }: { children: ReactNode; bg?: string; ink?: string; mono?: boolean }) {
  return <span className={"pill" + (mono ? " mono" : "")} style={{ background: bg, color: ink, fontSize: mono ? 11 : undefined }}>{children}</span>;
}

// ---------- controls ----------

export function Button({ primary, danger, lg, sm, icon, children, ...rest }: { primary?: boolean; danger?: boolean; lg?: boolean; sm?: boolean; icon?: ReactNode; children?: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={["btn", primary && "btn-primary", danger && "btn-danger", lg && "btn-lg", sm && "btn-sm"].filter(Boolean).join(" ")} {...rest}>
      {icon}
      {children}
    </button>
  );
}

export function IconButton({ on, children, ...rest }: { on?: boolean; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={"ibtn" + (on ? " ibtn-on" : "")} {...rest}>{children}</button>;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={"seg-i" + (o.value === value ? " seg-on" : "")} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Popup<T extends string>({ value, options, onChange, ask, style }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; ask?: boolean; style?: React.CSSProperties }) {
  return (
    <select className={"pop" + (ask ? " pop-ask" : "")} value={value} onChange={(e) => onChange(e.target.value as T)} style={style}>
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

export function Checkbox({ checked, onChange, label }: { checked: boolean; onChange?: (v: boolean) => void; label?: ReactNode }) {
  return (
    <label className="chk-row" onClick={() => onChange?.(!checked)}>
      <span className={"chk" + (checked ? " chk-on" : "")}>{checked && <Ic.Check size={10} stroke="#fff" strokeWidth={3.5} />}</span>
      {label}
    </label>
  );
}

export function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return <button className={"sw" + (on ? "" : " sw-off")} onClick={() => onChange(!on)} aria-pressed={on} />;
}

export function SearchField({ placeholder = "Search", value, onChange, width = 220 }: { placeholder?: string; value?: string; onChange?: (v: string) => void; width?: number }) {
  return (
    <div className="search" style={{ width }}>
      <Ic.Search size={13} />
      <input placeholder={placeholder} value={value ?? ""} onChange={(e) => onChange?.(e.target.value)} />
    </div>
  );
}

// ---------- chrome ----------

export function Toolbar({ title, subtitle, children, back }: { title: ReactNode; subtitle?: ReactNode; children?: ReactNode; back?: () => void }) {
  return (
    <div className="tb">
      <IconButton onClick={back} disabled={!back}><Ic.Back size={14} /></IconButton>
      <IconButton disabled><Ic.Fwd size={14} /></IconButton>
      <div className="tb-title">
        <b>{title}</b>
        {subtitle && <span>{subtitle}</span>}
      </div>
      <div className="grow" />
      {children}
    </div>
  );
}

export function Group({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="grp">
      <div className="grp-t" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <span>{title}</span>
        {right}
      </div>
      {children}
    </div>
  );
}

export function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className="v">{children}</span>
    </div>
  );
}

export function Progress({ value, max, color = "var(--accent)", height = 5 }: { value: number; max: number; color?: string; height?: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <span className="bar" style={{ flex: 1, height, background: "var(--border-faint)" }}>
      <i style={{ width: `${pct}%`, background: color }} />
    </span>
  );
}

export function Money({ v, muted }: { v: number; muted?: boolean }) {
  return <span className="mono" style={{ fontSize: 11, color: muted ? "var(--ink-4)" : undefined }}>${v.toFixed(2)}</span>;
}

// ---------- time helpers ----------

export function hhmm(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

export function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h`;
  return `${Math.round(h / 24)} d`;
}

export function dur(a: string | null, b: string | null): string {
  if (!a) return "";
  const end = b ? new Date(b).getTime() : Date.now();
  const s = Math.max(0, Math.round((end - new Date(a).getTime()) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  return b ? `${m}m` : `${m}m…`;
}

export function isToday(iso: string): boolean {
  const d = new Date(iso);
  const n = new Date();
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate();
}

export function modelLabel(model: string): string {
  const m: Record<string, string> = { "claude-opus-5": "Opus 5", "claude-sonnet-5": "Sonnet 5", "claude-haiku-4-5": "Haiku 4.5", "z-ai/glm-5.3": "GLM 5.3", "z-ai/glm-5.3-flash": "GLM 5.3 Flash" };
  return m[model] ?? model.split("/").pop() ?? model;
}
