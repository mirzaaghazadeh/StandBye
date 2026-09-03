import { tool, type ToolSet } from "ai";
import { z } from "zod";
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import type { PermissionRule } from "@crew/shared";
import { gate } from "./approval.js";
import type { ToolContext } from "../tools/team-tools.js";

/**
 * File and shell tools for models that do not bring their own harness. The Claude runner gets
 * these from Claude Code and the CLI runner from whichever agent it spawns; everything driven
 * by the plain tool loop gets them from here.
 *
 * Every one of them goes through `gate`, so the workspace fence and the owner's permission
 * rules apply exactly as they do to Claude Code's own tools.
 */
export function workspaceTools(ctx: ToolContext, cwd: string, rules: PermissionRule[]): ToolSet {
  const resolve = (p: string): string => {
    const abs = path.resolve(cwd, p);
    if (!abs.startsWith(cwd)) throw new Error(`Path ${p} is outside the workspace`);
    return abs;
  };
  return {
    read_file: tool({
      description: "Read a text file in the workspace (relative path). Returns up to 400 lines.",
      inputSchema: z.object({ path: z.string(), offset: z.number().int().min(1).optional(), limit: z.number().int().min(1).max(2000).optional() }),
      execute: async ({ path: p, offset, limit }) => {
        const v = await gate(ctx, rules, "Read", { file_path: p });
        if (!v.ok) return v.message;
        const lines = fs.readFileSync(resolve(p), "utf8").split("\n");
        const start = (offset ?? 1) - 1;
        const slice = lines.slice(start, start + (limit ?? 400));
        return slice.map((l, i) => `${start + i + 1}\t${l}`).join("\n") + (lines.length > start + slice.length ? `\n… ${lines.length - start - slice.length} more lines` : "");
      },
    }),
    write_file: tool({
      description: "Create or overwrite a file in the workspace.",
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path: p, content }) => {
        const v = await gate(ctx, rules, "Write", { file_path: p });
        if (!v.ok) return v.message;
        const abs = resolve(p);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content);
        return `Wrote ${content.split("\n").length} lines to ${p}.`;
      },
    }),
    edit_file: tool({
      description: "Replace an exact string in a file once. old_string must match exactly one location.",
      inputSchema: z.object({ path: z.string(), old_string: z.string(), new_string: z.string() }),
      execute: async ({ path: p, old_string, new_string }) => {
        const v = await gate(ctx, rules, "Edit", { file_path: p });
        if (!v.ok) return v.message;
        const abs = resolve(p);
        const src = fs.readFileSync(abs, "utf8");
        const n = src.split(old_string).length - 1;
        if (n !== 1) return n === 0 ? "old_string not found." : `old_string matches ${n} places; make it unique.`;
        fs.writeFileSync(abs, src.replace(old_string, new_string));
        return "Edited.";
      },
    }),
    list_files: tool({
      description: "List files under a directory (relative path, default '.'), recursively up to depth 3, skipping node_modules and .git.",
      inputSchema: z.object({ path: z.string().optional() }),
      execute: async ({ path: p }) => {
        const root = resolve(p ?? ".");
        const out: string[] = [];
        const walk = (dir: string, depth: number) => {
          if (depth > 3 || out.length > 400) return;
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
            const rel = path.relative(cwd, path.join(dir, e.name));
            out.push(e.isDirectory() ? rel + "/" : rel);
            if (e.isDirectory()) walk(path.join(dir, e.name), depth + 1);
          }
        };
        walk(root, 0);
        return out.join("\n") || "(empty)";
      },
    }),
    search_files: tool({
      description: "Search file contents with a regex (uses grep -rn). Returns matching lines.",
      inputSchema: z.object({ pattern: z.string(), path: z.string().optional() }),
      execute: async ({ pattern, path: p }) => run("grep", ["-rn", "--exclude-dir=node_modules", "--exclude-dir=.git", "-E", pattern, p ?? "."], cwd, 30_000),
    }),
    bash: tool({
      description: "Run a shell command in the workspace (2 minute timeout). Use for tests, git, builds.",
      inputSchema: z.object({ command: z.string() }),
      execute: async ({ command }) => {
        const v = await gate(ctx, rules, "Bash", { command });
        if (!v.ok) return v.message;
        return run("/bin/sh", ["-lc", command], cwd, 120_000);
      },
    }),
  };
}

/** Keep the first and last of a long output, and say plainly how much was dropped. */
export function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = text.slice(0, Math.floor(max * 0.7));
  const tail = text.slice(-Math.floor(max * 0.3));
  const dropped = text.length - head.length - tail.length;
  return `${head}\n\n… ${dropped} characters cut from the middle; narrow the command if you need them …\n\n${tail}`;
}

function run(cmd: string, args: string[], cwd: string, timeout: number): Promise<string> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      // Every byte here is re-sent on every later step of the run, so a fat `ls -R` or DOM dump is
      // paid for many times over. Keep the head and the tail, which is where the answer usually is.
      const out = clamp([stdout, stderr].filter(Boolean).join("\n"), 6000);
      if (err && !(err as NodeJS.ErrnoException).code) resolve(out || err.message);
      else if (err) resolve(`${out}\n[exit ${(err as { code?: number | string }).code}]`);
      else resolve(out || "(no output)");
    });
  });
}
