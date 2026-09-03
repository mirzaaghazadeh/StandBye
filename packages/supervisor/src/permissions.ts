import type { PermissionBehavior, PermissionRule } from "@crew/shared";

/**
 * Permission rules are matched most-specific-first against a tool signature.
 * Signatures look like Claude Code's: `Bash(git push origin main)`, `Edit(src/a.ts)`, `mcp__team__post_message`.
 * Patterns accept `*` as a wildcard and may omit the parenthesised part to match any input.
 */
export function decide(rules: PermissionRule[], toolName: string, input: Record<string, unknown>): { behavior: PermissionBehavior; rule?: PermissionRule } {
  const sig = signature(toolName, input);
  const matches = rules
    .map((rule) => ({ rule, score: matchScore(rule.pattern, toolName, sig) }))
    .filter((m) => m.score >= 0)
    // Most specific wins; on a tie the most restrictive wins, so an allow rule can never
    // quietly outrank an equally specific block (e.g. "git push*dev*" vs "git push -f*").
    .sort((a, b) => b.score - a.score || CAUTION[b.rule.behavior] - CAUTION[a.rule.behavior]);
  const best = matches[0];
  if (!best) return { behavior: "allow" };
  return { behavior: best.rule.behavior, rule: best.rule };
}

const CAUTION: Record<PermissionBehavior, number> = { allow: 0, ask: 1, block: 2 };

export function signature(toolName: string, input: Record<string, unknown>): string {
  const inner =
    typeof input.command === "string" ? input.command
    : typeof input.file_path === "string" ? input.file_path
    : typeof input.path === "string" ? input.path
    : typeof input.channel === "string" ? input.channel
    : "";
  return inner ? `${toolName}(${inner})` : toolName;
}

function matchScore(pattern: string, toolName: string, sig: string): number {
  const m = /^([^(]+)(?:\((.*)\))?$/.exec(pattern.trim());
  if (!m) return -1;
  const toolPat = m[1]!;
  const innerPat = m[2];
  if (!glob(toolPat, toolName)) return -1;
  if (innerPat === undefined) return toolPat.includes("*") ? 1 : 2;
  const innerMatch = /^[^(]+\((.*)\)$/.exec(sig);
  const inner = innerMatch ? innerMatch[1]! : "";
  if (!glob(innerPat, inner)) return -1;
  return 10 + innerPat.replace(/\*/g, "").length;
}

function glob(pattern: string, value: string): boolean {
  const re = new RegExp("^" + pattern.split("*").map(escapeRe).join(".*") + "$", "i");
  return re.test(value);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Default rules every dev-team agent starts with. The app enforces these; the model cannot talk its way past them. */
export const DEFAULT_DEV_RULES: PermissionRule[] = [
  { pattern: "Bash(git push*main*)", behavior: "ask", label: "Push to main" },
  { pattern: "Bash(git push*master*)", behavior: "ask", label: "Push to master" },
  { pattern: "Bash(git push --force*)", behavior: "block", label: "Force push" },
  { pattern: "Bash(rm -rf*)", behavior: "block", label: "Recursive delete" },
  { pattern: "Bash(sudo*)", behavior: "block", label: "sudo" },
  { pattern: "Bash(curl*)", behavior: "ask", label: "Network call" },
  { pattern: "Bash(*)", behavior: "allow" },
  { pattern: "Read", behavior: "allow" },
  { pattern: "Edit", behavior: "allow" },
  { pattern: "Write", behavior: "allow" },
  { pattern: "Glob", behavior: "allow" },
  { pattern: "Grep", behavior: "allow" },
  { pattern: "WebFetch", behavior: "ask", label: "Fetch a web page" },
  { pattern: "WebSearch", behavior: "allow" },
  { pattern: "mcp__team__*", behavior: "allow" },
];
