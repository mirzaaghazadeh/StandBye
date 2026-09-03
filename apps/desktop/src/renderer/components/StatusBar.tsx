import { PROVIDERS, type KeyStatus } from "@crew/shared";
import { store, useStore } from "../state/store";
import { hhmm } from "../ui/kit";

export function StatusBar() {
  const status = useStore((s) => s.status);
  const agents = useStore((s) => s.agents);
  const spend = useStore((s) => s.spend);
  const next = status?.nextWake ? agents.find((a) => a.id === status.nextWake!.agentId) : null;
  return (
    <div className="status">
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className="dot" style={{ width: 7, height: 7, background: status?.pausedAll || status?.pausePending ? "var(--amber)" : "var(--green)" }} />
        {status?.pausedAll ? "All agents paused"
          : status?.pausePending ? (status.runningRuns > 0 ? `Pausing when ${status.runningRuns === 1 ? "the last run finishes" : `the last of ${status.runningRuns} runs finishes`}` : "Pausing")
          : status ? `Supervisor running since ${hhmm(status.startedAt)}` : "Supervisor offline"}
      </span>
      {status && <span>{status.runsToday} runs today</span>}
      {next && status?.nextWake && <span>Next wake-up: {next.name} at {hhmm(status.nextWake.at)}</span>}
      <span className="grow" />
      {spend && <span>Check-ins today ${spend.checkinsUsd.toFixed(2)}</span>}
      {/* Naming the ready providers beats counting them: at a glance you see what the team is on. */}
      {status && <ProvidersReady keys={status.keys} />}
    </div>
  );
}

/**
 * Which providers can run, by name. Beyond three it becomes a count with the rest on hover,
 * because the status bar is one line and a team can be spread across a dozen of them.
 */
function ProvidersReady({ keys }: { keys: KeyStatus }) {
  const ready = PROVIDERS.filter((p) => keys[p.id]).map((p) => p.name);
  if (!ready.length) return <span style={{ color: "var(--amber)" }}><a onClick={() => store.openSheet({ kind: "keys" })}>No provider set up</a></span>;
  return <span title={ready.join(", ")}>{ready.length <= 3 ? ready.join(" · ") : `${ready.slice(0, 2).join(" · ")} +${ready.length - 2} more`}</span>;
}
