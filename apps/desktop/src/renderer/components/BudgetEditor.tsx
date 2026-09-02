import type { Budget, BudgetCap } from "@crew/shared";
import { Money, Progress, Segmented } from "../ui/kit";

/**
 * Budget in the unit the owner thinks in: per day, per hour, or per run.
 * All three limits are stored; the app enforces every one that is set.
 */
export function BudgetEditor({ budget, onChange, used, workHours, compact }: {
  budget: Budget;
  onChange: (b: Budget) => void;
  used?: number;
  workHours?: number;
  compact?: boolean;
}) {
  const capBy: BudgetCap = budget.capBy ?? "day";
  const hours = workHours ?? 14;
  const amount = capBy === "day" ? budget.dailyUsd : capBy === "hour" ? budget.hourlyUsd ?? +(budget.dailyUsd / hours).toFixed(2) : budget.perRunUsd;

  const setAmount = (raw: string) => {
    const v = Math.max(0, Number(raw) || 0);
    if (capBy === "day") onChange({ ...budget, capBy, dailyUsd: v, hourlyUsd: null });
    else if (capBy === "hour") onChange({ ...budget, capBy, hourlyUsd: v, dailyUsd: +(v * hours).toFixed(2) });
    else onChange({ ...budget, capBy, perRunUsd: v });
  };
  const setCap = (c: BudgetCap) => {
    if (c === "hour") onChange({ ...budget, capBy: c, hourlyUsd: budget.hourlyUsd ?? +(budget.dailyUsd / hours).toFixed(2) });
    else if (c === "day") onChange({ ...budget, capBy: c, hourlyUsd: null });
    else onChange({ ...budget, capBy: c });
  };

  const hint =
    capBy === "day" ? `Sleeps until tomorrow when reached. About $${(budget.dailyUsd / hours).toFixed(2)} per working hour.`
    : capBy === "hour" ? `Rolling 60-minute cap. About $${(amount * hours).toFixed(2)} per day over ${hours} working hours.`
    : `Each run stops when it passes this. Daily cap stays at $${budget.dailyUsd.toFixed(2)}.`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? 4 : 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Segmented value={capBy} onChange={setCap} options={[{ value: "day", label: "Day" }, { value: "hour", label: "Hour" }, { value: "run", label: "Run" }]} />
        <span className="mono" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 3 }}>
          $<input className="field mono" style={{ width: 64 }} value={amount} onChange={(e) => setAmount(e.target.value)} />
          <span style={{ color: "var(--ink-5)", fontSize: 11 }}>/ {capBy}</span>
        </span>
      </div>
      {!compact && <div style={{ fontSize: 11, color: "var(--ink-4)" }}>{hint}</div>}
      {used !== undefined && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--ink-4)" }}>
          <span style={{ width: 70 }}>Used today</span>
          <Progress value={used} max={budget.dailyUsd} />
          <Money v={used} />
        </div>
      )}
    </div>
  );
}

export function workHoursOf(wh: { start: string; end: string } | null): number {
  if (!wh) return 24;
  const [sh = 8, sm = 0] = wh.start.split(":").map(Number);
  const [eh = 22, em = 0] = wh.end.split(":").map(Number);
  return Math.max(1, (eh * 60 + em - (sh * 60 + sm)) / 60);
}
