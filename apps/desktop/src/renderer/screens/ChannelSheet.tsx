import { useState } from "react";
import type { Channel } from "@crew/shared";
import { store, useStore } from "../state/store";
import { Avatar, Button, Checkbox, KV } from "../ui/kit";

/** Create a group channel, or edit an existing one's purpose and members. */
export function ChannelSheet({ channelId }: { channelId?: string }) {
  const agents = useStore((s) => s.agents);
  const existing = useStore((s) => (channelId ? s.channels.find((c) => c.id === channelId) : undefined));
  const [name, setName] = useState(existing?.name ?? "");
  const [purpose, setPurpose] = useState(existing?.purpose ?? "");
  const [members, setMembers] = useState<string[]>(existing?.members ?? agents.map((a) => a.id));
  const [busy, setBusy] = useState(false);
  const toggle = (id: string) => setMembers((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));

  const save = async () => {
    setBusy(true);
    try {
      if (existing) {
        await store.rpc<Channel>("channels.update", { id: existing.id, purpose: purpose.trim(), members });
      } else {
        const c = await store.rpc<Channel>("channels.create", { name: name.trim(), purpose: purpose.trim(), members });
        store.navigate({ name: "channel", channelId: c.id });
      }
      const channels = await store.rpc<Channel[]>("channels.list");
      store.setChannels(channels);
      store.closeSheet();
      store.toast(existing ? "Channel updated." : `#${name.trim().toLowerCase()} created.`);
    } catch (e) {
      store.toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!existing || !confirm(`Delete #${existing.name} and its messages?`)) return;
    await store.rpc("channels.delete", { id: existing.id });
    store.setChannels(await store.rpc<Channel[]>("channels.list"));
    store.navigate({ name: "home" });
    store.closeSheet();
  };

  return (
    <div className="sheet" style={{ width: 520, height: 460 }}>
      <div className="sheet-h"><b>{existing ? `#${existing.name}` : "New channel"}</b><span style={{ fontSize: 12, color: "var(--ink-4)" }}>A room for a topic. Members see every message and reply when it concerns them.</span></div>
      <div className="sheet-body" style={{ flexDirection: "column", padding: "16px 20px", gap: 12, overflowY: "auto" }}>
        <div style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--surface)", padding: "8px 12px" }}>
          <KV k="Name"><span style={{ display: "inline-flex", alignItems: "center", gap: 4, flex: 1 }}><span style={{ color: "var(--ink-4)" }}>#</span><input className="field" value={name} disabled={Boolean(existing)} onChange={(e) => setName(e.target.value)} placeholder="frontend" autoFocus={!existing} /></span></KV>
          <KV k="Purpose"><input className="field" value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="What this room is for" /></KV>
        </div>
        <div style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--surface)", padding: "8px 12px" }}>
          <div className="grp-t" style={{ marginTop: 4 }}>Members</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "2px 0 6px" }}>
            {agents.map((a) => (
              <div key={a.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Checkbox checked={members.includes(a.id)} onChange={() => toggle(a.id)} />
                <Avatar agent={a} size={20} />
                <span style={{ flex: 1 }}>{a.name}</span>
                <span style={{ fontSize: 11, color: "var(--ink-4)" }}>{a.role}</span>
              </div>
            ))}
            {agents.length === 0 && <div style={{ fontSize: 12, color: "var(--ink-5)" }}>No agents yet.</div>}
          </div>
        </div>
      </div>
      <div className="sheet-f">
        {existing && existing.id !== "general" && <Button danger onClick={() => void remove()}>Delete Channel…</Button>}
        <span className="grow" />
        <Button lg onClick={() => store.closeSheet()}>Cancel</Button>
        <Button lg primary onClick={() => void save()} disabled={busy || (!existing && !name.trim())}>{existing ? "Save" : "Create Channel"}</Button>
      </div>
    </div>
  );
}
