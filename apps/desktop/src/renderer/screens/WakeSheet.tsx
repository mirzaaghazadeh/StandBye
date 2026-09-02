import { useState } from "react";
import { store, useStore } from "../state/store";
import { Avatar, Button } from "../ui/kit";

/** Send a direct instruction to one agent. It wakes with the message as its trigger. */
export function WakeSheet({ agentId }: { agentId: string }) {
  const agent = useStore((s) => s.agents.find((a) => a.id === agentId));
  const [text, setText] = useState("");
  if (!agent) return null;
  const send = async () => { if (!text.trim()) return; await store.wakeAgent(agent.id, text.trim()); store.closeSheet(); };
  return (
    <div className="sheet" style={{ width: 560, height: 340 }}>
      <div className="sheet-h"><Avatar agent={agent} size={24} /><b>Talk to {agent.name}</b><span style={{ fontSize: 12, color: "var(--ink-4)" }}>{agent.role}. Wakes immediately with this message.</span></div>
      <div className="sheet-body" style={{ padding: "18px 20px" }}>
        <textarea className="field" autoFocus style={{ width: "100%", height: "100%" }} placeholder={`What should ${agent.name} do?`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void send(); }} />
      </div>
      <div className="sheet-f">
        <span style={{ fontSize: 12, color: "var(--ink-4)" }}>⌘↩ to send</span>
        <span className="grow" />
        <Button lg onClick={() => store.closeSheet()}>Cancel</Button>
        <Button lg primary onClick={() => void send()} disabled={!text.trim()}>Send</Button>
      </div>
    </div>
  );
}
