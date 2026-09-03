import type { ModelMessage } from "ai";

/**
 * Keeping a run's conversation small.
 *
 * In a tool loop the whole conversation is re-sent on every step, so the bill is roughly
 * the sum of the context size at each step, not the size at the end. A 10 KB tool result
 * added at step 5 of a 40-step run is paid for about 35 times. Measured on a real build:
 * 3.7M input tokens against 120k output, a ratio of 30:1.
 *
 * So we do what Claude Code does: keep the task and the recent turns verbatim, and replace
 * the *contents* of older tool results with a one-line stand-in. The model still sees that
 * the call happened and what it was, just not the payload it has already used.
 */

export interface TrimOptions {
  /** Tool results from the last N assistant turns stay verbatim. */
  keepRecentTurns: number;
  /** Results shorter than this are never worth replacing. */
  minChars: number;
}

export const DEFAULT_TRIM: TrimOptions = { keepRecentTurns: 3, minChars: 600 };

const PLACEHOLDER = (chars: number, hint: string) =>
  `[${chars} characters dropped from this earlier tool result to keep the run cheap${hint ? `: ${hint}` : ""}. Re-run the tool if you need it again.]`;

/**
 * Rewrite the conversation for the next step. Returns the same array when nothing is worth
 * dropping, so an unchanged prefix stays byte-identical and provider caching still hits.
 */
export function trimConversation(messages: ModelMessage[], opts: TrimOptions = DEFAULT_TRIM): ModelMessage[] {
  // Index of the assistant turn that starts the "recent" window; everything at or after it is kept.
  const assistantIdx: number[] = [];
  messages.forEach((m, i) => { if (m.role === "assistant") assistantIdx.push(i); });
  if (assistantIdx.length <= opts.keepRecentTurns) return messages;
  const keepFrom = assistantIdx[assistantIdx.length - opts.keepRecentTurns] ?? messages.length;

  let changed = false;
  const out = messages.map((m, i) => {
    if (i >= keepFrom || m.role !== "tool" || !Array.isArray(m.content)) return m;
    const content = m.content.map((part) => {
      if (part.type !== "tool-result") return part;
      const { text, hint } = describe(part.output);
      if (text === null || text.length < opts.minChars) return part;
      changed = true;
      return { ...part, output: { type: "text" as const, value: PLACEHOLDER(text.length, hint) } };
    });
    return changed ? { ...m, content } : m;
  });
  return changed ? out : messages;
}

/** Pull the printable payload out of a tool result, whatever shape the tool returned. */
function describe(output: unknown): { text: string | null; hint: string } {
  if (typeof output === "string") return { text: output, hint: "" };
  const o = output as { type?: string; value?: unknown } | null;
  if (!o || typeof o !== "object") return { text: null, hint: "" };
  if (o.type === "text" && typeof o.value === "string") return { text: o.value, hint: firstLine(o.value) };
  if (o.type === "json") {
    const s = JSON.stringify(o.value);
    return { text: s, hint: "" };
  }
  return { text: null, hint: "" };
}

function firstLine(s: string): string {
  const line = s.split("\n", 1)[0] ?? "";
  return line.length > 60 ? line.slice(0, 57) + "…" : line;
}
