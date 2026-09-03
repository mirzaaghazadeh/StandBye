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

const SUPERSEDED = (chars: number, path: string) =>
  `[${chars} characters dropped: you read ${path} again later in this run, and that newer copy is still above. Use it — do not read this file a third time.]`;

/**
 * Rewrite the conversation for the next step. Returns the same array when nothing is worth
 * dropping, so an unchanged prefix stays byte-identical and provider caching still hits.
 */
export function trimConversation(messages: ModelMessage[], opts: TrimOptions = DEFAULT_TRIM): ModelMessage[] {
  // Index of the assistant turn that starts the "recent" window; everything at or after it is kept.
  const assistantIdx: number[] = [];
  messages.forEach((m, i) => { if (m.role === "assistant") assistantIdx.push(i); });
  const superseded = supersededReads(messages);
  if (assistantIdx.length <= opts.keepRecentTurns && superseded.size === 0) return messages;
  const keepFrom = assistantIdx.length > opts.keepRecentTurns
    ? assistantIdx[assistantIdx.length - opts.keepRecentTurns] ?? messages.length
    : messages.length;

  let changed = false;
  const out = messages.map((m, i) => {
    if (m.role !== "tool" || !Array.isArray(m.content)) return m;
    const old = i < keepFrom;
    const content = m.content.map((part) => {
      if (part.type !== "tool-result") return part;
      const stale = superseded.get(part.toolCallId);
      if (!old && !stale) return part;
      const { text, hint } = describe(part.output);
      if (text === null || text.length < opts.minChars) return part;
      changed = true;
      const value = stale ? SUPERSEDED(text.length, stale) : PLACEHOLDER(text.length, hint);
      return { ...part, output: { type: "text" as const, value } };
    });
    return changed ? { ...m, content } : m;
  });
  return changed ? out : messages;
}

/** Tools whose result is simply the current contents of one file, so an older copy is dead weight. */
const READ_TOOLS = new Set(["read_file", "Read", "mcp__workspace__read_file"]);

/**
 * Agents re-read the same file several times in a run — measured on a real run: nine reads of
 * four distinct files, one of them read four times. Every copy but the newest is stale by
 * definition, and each one is re-sent on every following step. So we keep the newest read of a
 * file verbatim, however recent the older ones are, and replace the rest with a line saying
 * where the current contents are. Nothing is lost: the model still has the file, once.
 */
function supersededReads(messages: ModelMessage[]): Map<string, string> {
  const newestByPath = new Map<string, string>();  // path -> the toolCallId that still matters
  const pathByCall = new Map<string, string>();
  for (const m of messages) {
    if (m.role !== "assistant" || !Array.isArray(m.content)) continue;
    for (const part of m.content) {
      if (part.type !== "tool-call" || !READ_TOOLS.has(part.toolName)) continue;
      const input = part.input as { path?: unknown; file_path?: unknown; offset?: unknown } | undefined;
      const p = typeof input?.path === "string" ? input.path : typeof input?.file_path === "string" ? input.file_path : null;
      // A windowed read is not the whole file, so a later full read does not supersede it.
      if (!p || input?.offset !== undefined) continue;
      pathByCall.set(part.toolCallId, p);
      newestByPath.set(p, part.toolCallId);
    }
  }
  const stale = new Map<string, string>();
  for (const [callId, p] of pathByCall) if (newestByPath.get(p) !== callId) stale.set(callId, p);
  return stale;
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
