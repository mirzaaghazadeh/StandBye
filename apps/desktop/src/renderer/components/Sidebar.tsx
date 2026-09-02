import { store, useStore } from "../state/store";
import { Ic } from "../ui/icons";
import { StatusDot } from "../ui/kit";

export function Sidebar() {
  const route = useStore((s) => s.route);
  const team = useStore((s) => s.team);
  const agents = useStore((s) => s.agents);
  const channels = useStore((s) => s.channels);
  const questions = useStore((s) => s.questions);
  const spend = useStore((s) => s.spend);
  const messages = useStore((s) => s.messages);

  const openForUser = questions.filter((q) => q.status === "open" && q.toId === "user").length;
  const working = agents.filter((a) => a.status === "working").length;
  const is = (name: string, id?: string) => route.name === name && (!id || ("channelId" in route && route.channelId === id));

  return (
    <aside className="side">
      <div className="side-drag" />
      <div className="side-ws">
        <span style={{ width: 20, height: 20, borderRadius: 5, background: "var(--accent)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
          <Ic.Team size={12} stroke="#fff" />
        </span>
        <span className="side-ws-name">{team?.name ?? "No team yet"}</span>
        <span style={{ fontSize: 11, color: "var(--ink-5)" }}>{team ? `${working} working` : ""}</span>
      </div>

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

      <div className="sec">Channels</div>
      {channels.length === 0 && <div className="srow" style={{ color: "var(--ink-5)" }}>No channels yet</div>}
      {channels.map((c) => {
        const on = is("channel", c.id);
        const unread = !on && (messages[c.id]?.some((m) => m.kind === "question" && questions.find((q) => q.id === m.questionId)?.status === "open") ?? false);
        return (
          <button key={c.id} className={"srow" + (on ? " srow-on" : "")} onClick={() => store.navigate({ name: "channel", channelId: c.id })}>
            <Ic.Hash stroke={on ? "var(--accent)" : "var(--ink-3)"} />
            <span className="grow" style={{ fontWeight: unread ? 600 : undefined }}>{c.name}</span>
            {unread && <span className="dot" style={{ width: 7, height: 7, background: "var(--accent)" }} />}
          </button>
        );
      })}

      <div className="sec">Agents</div>
      {agents.length === 0 && <div className="srow" style={{ color: "var(--ink-5)" }}>No agents yet</div>}
      {agents.map((a) => (
        <button key={a.id} className={"srow" + (route.name === "agent" && route.agentId === a.id ? " srow-on" : "")} onClick={() => { store.navigate({ name: "agent", agentId: a.id }); }}>
          <StatusDot status={a.status} />
          <span className="grow">{a.name}</span>
          <span className="hint">{a.role.split(" ")[0]?.toLowerCase()}</span>
        </button>
      ))}

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
