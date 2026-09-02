import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Agent } from "@crew/shared";
import { Ic } from "../ui/icons";
import { Avatar, IconButton } from "../ui/kit";

/** Message composer with @-mention autocomplete. Return sends, Shift+Return adds a line. */
export function Compose({ placeholder, agents, onSend, hint }: { placeholder: string; agents: Agent[]; onSend: (text: string) => void; hint?: string }) {
  const [text, setText] = useState("");
  const [mention, setMention] = useState<{ start: number; query: string } | null>(null);
  const [cursor, setCursor] = useState(0);
  const [pos, setPos] = useState({ left: 0, bottom: 0 });
  const ref = useRef<HTMLTextAreaElement>(null);

  const matches = mention ? agents.filter((a) => a.name.toLowerCase().startsWith(mention.query.toLowerCase()) || a.id.startsWith(mention.query.toLowerCase())).slice(0, 6) : [];
  useEffect(() => { setCursor(0); }, [mention?.query]);

  const detect = (value: string, caret: number) => {
    const before = value.slice(0, caret);
    const m = /(^|\s)@([\w-]*)$/.exec(before);
    if (!m) { setMention(null); return; }
    setMention({ start: caret - m[2]!.length - 1, query: m[2]! });
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left + 8, bottom: window.innerHeight - r.top + 6 });
  };
  const pick = (a: Agent) => {
    if (!mention) return;
    const caret = ref.current?.selectionStart ?? text.length;
    const next = text.slice(0, mention.start) + "@" + a.name + " " + text.slice(caret);
    setText(next);
    setMention(null);
    requestAnimationFrame(() => { const el = ref.current; if (el) { const p = mention.start + a.name.length + 2; el.focus(); el.setSelectionRange(p, p); } });
  };
  const send = () => { const t = text.trim(); if (!t) return; setText(""); setMention(null); onSend(t); };

  return (
    <>
      <div className="compose">
        <textarea
          ref={ref}
          rows={1}
          placeholder={placeholder}
          value={text}
          onChange={(e) => { setText(e.target.value); detect(e.target.value, e.target.selectionStart ?? e.target.value.length); }}
          onKeyDown={(e) => {
            if (mention && matches.length) {
              if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(matches.length - 1, c + 1)); return; }
              if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); return; }
              if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(matches[cursor]!); return; }
              if (e.key === "Escape") { setMention(null); return; }
            }
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
          }}
          onBlur={() => setTimeout(() => setMention(null), 150)}
        />
        <IconButton onClick={send} disabled={!text.trim()} style={{ color: text.trim() ? "var(--accent)" : undefined }}><Ic.Send size={15} /></IconButton>
      </div>
      {hint && <div style={{ fontSize: 11, color: "var(--ink-5)", marginTop: 6 }}>{hint}</div>}
      {mention && matches.length > 0 && createPortal(
        <div className="mention-pop" style={{ left: pos.left, bottom: pos.bottom }}>
          {matches.map((a, i) => (
            <button key={a.id} className={"li" + (i === cursor ? " li-sel" : "")} style={{ padding: "6px 10px", alignItems: "center", gap: 8 }} onMouseDown={(e) => { e.preventDefault(); pick(a); }} onMouseEnter={() => setCursor(i)}>
              <Avatar agent={a} size={20} />
              <span style={{ flex: 1, minWidth: 0 }} className="cell"><b style={{ fontWeight: 600 }}>{a.name}</b><span style={{ color: "var(--ink-4)" }}> · {a.role}</span></span>
              <span style={{ fontSize: 10.5, color: "var(--ink-5)" }}>{a.status.replace("_", " ")}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
