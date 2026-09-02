import { store, useStore } from "../state/store";
import { Ic } from "../ui/icons";
import { Avatar, STATUS_COLOR } from "../ui/kit";
import { TeamSwitcher } from "./TeamSwitcher";

export function Sidebar() {
  const route = useStore((s) => s.route);
  const agents = useStore((s) => s.agents);
  const seen = useStore((s) => s.seen);
  const channels = useStore((s) => s.channels);
  const questions = useStore((s) => s.questions);
  const spend = useStore((s) => s.spend);
  const messages = useStore((s) => s.messages);

  const openForUser = questions.filter((q) => q.status === "open" && q.toId === "user").length;
  const is = (name: string, id?: string) => route.name === name && (!id || ("channelId" in route && route.channelId === id));

  return (
    <aside className="side">
      <div className="side-drag" />
      <TeamSwitcher />

      <div className="sec">Team</div>
      <button className={"srow" + (is("home") || is("agent") ? " srow-on" : "")} onClick={() => store.navigate({ name: "home" })}>
        <Ic.Home stroke={is("home") ? "var(--accent)" : "var(--ink-3)"} />
        <span className="grow">Home</span>
      </button>
      <button className={"srow" + (is("inbox") ? " srow-on" : "")} onClick={() => store.navigate({ name: "inbox" })}>
        <Ic.Inbox stroke={is("inbox") ? "var(--accent)" : "var(--ink-3)"} />
        <span className="grow">Inbox</span>
        {openForUser > 0 && <span className="badge">{openForUser}</span>}
      </button>
      <button className={"srow" + (is("runs") ? " srow-on" : "")} onClick={() => store.navigate({ name: "runs" })}>
        <Ic.Runs stroke={is("runs") ? "var(--accent)" : "var(--ink-3)"} />
        <span className="grow">Runs</span>
      </button>

      <div className="sec" style={{ display: "flex", alignItems: "center" }}>
        <span style={{ flex: 1 }}>Channels</span>
        {agents.length > 0 && <button className="ibtn" style={{ width: 20, height: 18 }} title="New channel" onClick={() => store.openSheet({ kind: "channel" })}><Ic.Plus size={11} /></button>}
      </div>
      {channels.filter((c) => c.kind !== "dm").length === 0 && <div className="srow" style={{ color: "var(--ink-5)" }}>No channels yet</div>}
      {channels.filter((c) => c.kind !== "dm").map((c) => {
        const on = is("channel", c.id);
        const unread = !on && (messages[c.id]?.some((m) => m.kind === "question" && questions.find((q) => q.id === m.questionId)?.status === "open") ?? false);
        return (
          <button key={c.id} className={"srow" + (on ? " srow-on" : "")} onClick={() => store.navigate({ name: "channel", channelId: c.id })} onDoubleClick={() => store.openSheet({ kind: "channel", channelId: c.id })} title="Double-click to edit">
            <Ic.Hash stroke={on ? "var(--accent)" : "var(--ink-3)"} />
            <span className="grow" style={{ fontWeight: unread ? 600 : undefined }}>{c.name}</span>
            {unread && <span className="dot" style={{ width: 7, height: 7, background: "var(--accent)" }} />}
          </button>
        );
      })}

      <div className="sec">Direct chats</div>
      {agents.length === 0 && <div className="srow" style={{ color: "var(--ink-5)" }}>No agents yet</div>}
      {agents.map((a) => {
        const dm = messages[`dm-${a.id}`];
        const last = dm?.[dm.length - 1];
        const unread = Boolean(last && last.authorId === a.id && !(route.name === "dm" && route.agentId === a.id) && last.createdAt > (seen[`dm-${a.id}`] ?? ""));
        return (
          <button key={a.id} className={"srow" + (route.name === "dm" && route.agentId === a.id ? " srow-on" : "")} onClick={() => { store.navigate({ name: "dm", agentId: a.id }); }} title={`${a.name} · ${a.role}`}>
            <span style={{ position: "relative", display: "inline-flex", flexShrink: 0 }}>
              <Avatar agent={a} size={18} />
              <span className="dot" style={{ position: "absolute", right: -2, bottom: -1, width: 7, height: 7, background: STATUS_COLOR[a.status], boxShadow: "0 0 0 1.5px var(--side-solid)" }} />
            </span>
            <span className="grow" style={{ fontWeight: unread ? 600 : undefined }}>{a.name}</span>
            {unread ? <span className="dot" style={{ width: 7, height: 7, background: "var(--accent)" }} /> : <span className="hint">{a.role.split(" ")[0]?.toLowerCase()}</span>}
          </button>
        );
      })}

      <div className="grow" />
      {spend && (
        <div className="side-spend">
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--ink-3)" }}>
            <span>Spend today</span>
            <span className="mono">${spend.todayUsd.toFixed(2)} / ${spend.capUsd}</span>
          </div>
          <div className="bar" style={{ marginTop: 6 }}><i style={{ width: `${Math.min(100, (spend.todayUsd / Math.max(1, spend.capUsd)) * 100)}%` }} /></div>
        </div>
      )}
      <button className="srow" style={{ marginBottom: 10 }} onClick={() => store.openSheet({ kind: "keys" })}>
        <Ic.Settings stroke="var(--ink-3)" />
        <span className="grow">Settings</span>
      </button>
    </aside>
  );
}
