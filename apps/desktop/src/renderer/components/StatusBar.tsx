import { useStore } from "../state/store";
import { hhmm } from "../ui/kit";

export function StatusBar() {
  const status = useStore((s) => s.status);
  const agents = useStore((s) => s.agents);
  const spend = useStore((s) => s.spend);
  const next = status?.nextWake ? agents.find((a) => a.id === status.nextWake!.agentId) : null;
  return (
    <div className="status">
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className="dot" style={{ width: 7, height: 7, background: status?.pausedAll ? "var(--amber)" : "var(--green)" }} />
        {status?.pausedAll ? "All agents paused" : status ? `Supervisor running since ${hhmm(status.startedAt)}` : "Supervisor offline"}
      </span>
      {status && <span>{status.runsToday} runs today</span>}
      {next && status?.nextWake && <span>Next wake-up: {next.name} at {hhmm(status.nextWake.at)}</span>}
      <span className="grow" />
      {spend && <span>Check-ins today ${spend.checkinsUsd.toFixed(2)}</span>}
      {status && <span>{status.keys.anthropic ? "Anthropic key ok" : "No Anthropic key"} · {status.keys.openrouter ? "OpenRouter key ok" : "No OpenRouter key"}</span>}
    </div>
  );
}
