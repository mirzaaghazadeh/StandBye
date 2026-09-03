import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_DEV_RULES, decide, signature } from "../dist/permissions.js";

test("signature: the part of the input a rule can match on", async (t) => {
  await t.test("bash commands", () => {
    assert.equal(signature("Bash", { command: "git push origin main" }), "Bash(git push origin main)");
  });
  await t.test("file tools use file_path, then path", () => {
    assert.equal(signature("Edit", { file_path: "/repo/a.ts" }), "Edit(/repo/a.ts)");
    assert.equal(signature("read_file", { path: "src/a.ts" }), "read_file(src/a.ts)");
  });
  await t.test("channel tools", () => {
    assert.equal(signature("post_message", { channel: "backend" }), "post_message(backend)");
  });
  await t.test("no recognised field means the bare tool name", () => {
    assert.equal(signature("list_agents", {}), "list_agents");
    assert.equal(signature("Bash", { unrelated: "x" }), "Bash");
  });
  await t.test("command wins over file_path when both are present", () => {
    assert.equal(signature("Bash", { command: "cat a", file_path: "/a" }), "Bash(cat a)");
  });
});

test("decide: the most specific matching rule wins", async (t) => {
  await t.test("a specific block beats a broad allow", () => {
    const rules = [
      { pattern: "Bash(*)", behavior: "allow" },
      { pattern: "Bash(rm -rf*)", behavior: "block", label: "Recursive delete" },
    ];
    assert.equal(decide(rules, "Bash", { command: "rm -rf /tmp/x" }).behavior, "block");
    assert.equal(decide(rules, "Bash", { command: "ls -la" }).behavior, "allow");
  });

  await t.test("rule order does not matter, only specificity", () => {
    const a = [{ pattern: "Bash(rm*)", behavior: "block" }, { pattern: "Bash(*)", behavior: "allow" }];
    const b = [{ pattern: "Bash(*)", behavior: "allow" }, { pattern: "Bash(rm*)", behavior: "block" }];
    assert.equal(decide(a, "Bash", { command: "rm x" }).behavior, "block");
    assert.equal(decide(b, "Bash", { command: "rm x" }).behavior, "block");
  });

  await t.test("a rule with no parentheses matches any input for that tool", () => {
    const rules = [{ pattern: "Edit", behavior: "ask", label: "Edit a file" }];
    const d = decide(rules, "Edit", { file_path: "/repo/x.ts" });
    assert.equal(d.behavior, "ask");
    assert.equal(d.rule.label, "Edit a file");
  });

  await t.test("an inner pattern beats a bare tool pattern", () => {
    const rules = [
      { pattern: "Bash", behavior: "block" },
      { pattern: "Bash(npm test*)", behavior: "allow" },
    ];
    assert.equal(decide(rules, "Bash", { command: "npm test -- --watch" }).behavior, "allow");
    assert.equal(decide(rules, "Bash", { command: "npm publish" }).behavior, "block");
  });

  await t.test("wildcard tool names match, and score below an exact tool name", () => {
    const rules = [
      { pattern: "mcp__team__*", behavior: "block" },
      { pattern: "mcp__team__post_message", behavior: "allow" },
    ];
    assert.equal(decide(rules, "mcp__team__post_message", {}).behavior, "allow");
    assert.equal(decide(rules, "mcp__team__ask_user", {}).behavior, "block");
  });

  await t.test("nothing matches means allow", () => {
    assert.equal(decide([], "Bash", { command: "ls" }).behavior, "allow");
    assert.equal(decide([{ pattern: "Read", behavior: "block" }], "Bash", { command: "ls" }).behavior, "allow");
  });

  await t.test("matching is case-insensitive", () => {
    assert.equal(decide([{ pattern: "Bash(GIT PUSH*)", behavior: "block" }], "Bash", { command: "git push origin x" }).behavior, "block");
  });

  await t.test("a malformed pattern is ignored rather than throwing", () => {
    const rules = [{ pattern: "(oops)", behavior: "block" }, { pattern: "Bash(*)", behavior: "allow" }];
    assert.equal(decide(rules, "Bash", { command: "ls" }).behavior, "allow");
  });
});

test("DEFAULT_DEV_RULES: what a new agent may do out of the box", async (t) => {
  const check = (tool, input) => decide(DEFAULT_DEV_RULES, tool, input);

  await t.test("pushing to main asks the owner", () => {
    const d = check("Bash", { command: "git push origin main" });
    assert.equal(d.behavior, "ask");
    assert.equal(d.rule.label, "Push to main");
  });
  await t.test("force push and destructive commands are blocked outright", () => {
    assert.equal(check("Bash", { command: "git push --force origin feature" }).behavior, "block");
    assert.equal(check("Bash", { command: "rm -rf node_modules" }).behavior, "block");
    assert.equal(check("Bash", { command: "sudo rm x" }).behavior, "block");
  });
  await t.test("ordinary commands and file tools are allowed", () => {
    assert.equal(check("Bash", { command: "npm test" }).behavior, "allow");
    assert.equal(check("Bash", { command: "git push origin feature-x" }).behavior, "allow");
    assert.equal(check("Read", { file_path: "/repo/a.ts" }).behavior, "allow");
    assert.equal(check("Edit", { file_path: "/repo/a.ts" }).behavior, "allow");
    assert.equal(check("Write", { file_path: "/repo/a.ts" }).behavior, "allow");
    assert.equal(check("Grep", { pattern: "x" }).behavior, "allow");
  });
  await t.test("network calls ask", () => {
    assert.equal(check("Bash", { command: "curl https://example.com" }).behavior, "ask");
    assert.equal(check("WebFetch", { url: "https://example.com" }).behavior, "ask");
  });
  await t.test("team tools are always allowed", () => {
    assert.equal(check("mcp__team__post_message", { channel: "general" }).behavior, "allow");
    assert.equal(check("mcp__team__ask_user", {}).behavior, "allow");
  });
});
