import path from "node:path";
import type { PermissionRule } from "@crew/shared";
import { DEFAULTS } from "../config.js";
import { decide, signature } from "../permissions.js";
import type { ToolContext } from "../tools/team-tools.js";

export type Verdict = { ok: true } | { ok: false; message: string };

/**
 * Shared permission gate for both runners. "allow" passes, "block" fails immediately,
 * "ask" files an approval with the owner and waits (bounded), so the agent is never
 * the one deciding whether it may push to main.
 */
export async function gate(ctx: ToolContext, rules: PermissionRule[], toolName: string, input: Record<string, unknown>, workspace?: string): Promise<Verdict> {
  const sig = signature(toolName, input);
  // File tools stay inside the workspace, whatever the rules say. Reads of the agent's own folder
  // are fine, and so are the shared skill shelves: a skill's scripts/ and references/ live there,
  // and a skill the agent cannot open is not a skill.
  const fp = typeof input.file_path === "string" ? input.file_path : typeof input.path === "string" ? input.path : null;
  if (workspace && fp && path.isAbsolute(fp)) {
    const abs = path.resolve(fp);
    const allowed = [workspace, ctx.crew.store.agentDir(ctx.agentId), ...ctx.crew.skills.readableRoots()].some((root) => abs === root || abs.startsWith(root + path.sep));
    if (!allowed) {
      ctx.crew.addStep(ctx.run.id, "info", `Blocked: ${sig} is outside the workspace`);
      return { ok: false, message: `${fp} is outside your workspace (${workspace}). Stay inside it.` };
    }
  }
  const { behavior, rule } = decide(rules, toolName, input);
  if (behavior === "allow") return { ok: true };
  // On full autonomy there is nobody waiting to answer, so an "ask" rule would park the run
  // until it timed out and then fail — the opposite of running unattended. The owner chose
  // that when they set the dial, so "ask" passes and is recorded instead. "block" still blocks:
  // that is the line no level of autonomy crosses.
  if (behavior === "ask" && (ctx.crew.team?.autonomy ?? "pr") === "auto") {
    ctx.crew.addStep(ctx.run.id, "info", `Allowed without asking (team is on full autonomy; rule "${rule?.label ?? rule?.pattern}"): ${sig}`);
    return { ok: true };
  }
  if (behavior === "block") {
    ctx.crew.addStep(ctx.run.id, "info", `Blocked by rule "${rule?.label ?? rule?.pattern}": ${sig}`);
    return { ok: false, message: `Blocked by team rule${rule?.label ? ` "${rule.label}"` : ""}: ${sig}. Do not retry; find another way or tell the team.` };
  }
  const owner = ctx.crew.team?.ownerName ?? "the owner";
  const q = ctx.crew.askQuestion({
    kind: "approval", fromAgentId: ctx.agentId, toId: "user",
    channel: ctx.crew.getAgent(ctx.agentId).channels.find((c) => c !== "general" && !c.startsWith("dm-")) ?? "general",
    title: `${rule?.label ?? "Approve"}: ${sig.length > 90 ? sig.slice(0, 90) + "…" : sig}`,
    body: `${ctx.crew.getAgent(ctx.agentId).name} wants to run ${sig}. Rule: ${rule?.pattern}.`,
    options: ["Approve", "Deny"], recommended: null, payload: { tool: toolName, input }, runId: ctx.run.id,
  });
  ctx.crew.addStep(ctx.run.id, "ask", `Waiting for ${owner}'s approval: ${sig}`);
  ctx.crew.updateRun(ctx.run, { status: "needs_you" });
  const answer = await ctx.crew.waitOnOwner(q.id, ctx.run.id, DEFAULTS.approvalTimeoutMinutes * 60_000);
  ctx.crew.updateRun(ctx.run, { status: "running" });
  if (answer && /^(approve|yes|ok|allow)/i.test(answer)) {
    ctx.crew.addStep(ctx.run.id, "info", `${owner} approved: ${sig}`);
    return { ok: true };
  }
  if (answer === null) return { ok: false, message: `${owner} hasn't answered the approval for ${sig} yet. Don't retry now; finish what you can and say it's waiting.` };
  return { ok: false, message: `${owner} denied: ${sig}${answer !== "Deny" ? ` (${answer})` : ""}. Do not retry.` };
}
