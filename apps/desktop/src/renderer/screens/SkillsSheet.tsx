import { useEffect, useMemo, useState } from "react";
import type { Skill, SkillCandidate, SkillInstallKind, SkillOrigin, SkillScope, SkillSourceScan } from "@crew/shared";
import { store, useStore } from "../state/store";
import { Ic } from "../ui/icons";
import { Avatar, Button, Checkbox, IconButton, Popup, SearchField, Segmented } from "../ui/kit";

/**
 * The skill library: everything installed, on all three shelves, and every way to get more.
 *
 * Skills are the Agent Skills format, so "install" is really "copy a folder onto a shelf" —
 * from Claude Code's own folders, a GitHub repo, a folder on disk, or a zip.
 */

type Shelf = { key: string; scope: SkillScope; ownerId: string | null; label: string; sub: string };

/**
 * There is one user shelf and one team shelf, so only agent skills are told apart by owner.
 * (A team skill carries its team id as the owner; the shelf does not need to know it.)
 */
function onShelf(s: { scope: SkillScope; ownerId: string | null }, shelf: Shelf): boolean {
  return s.scope === shelf.scope && (shelf.scope !== "agent" || s.ownerId === shelf.ownerId);
}

/** Where a hand-written skill starts: valid frontmatter and the two headings that matter. */
const STARTER = (name: string, description: string) =>
  `---\nname: ${name}\ndescription: ${description}\n---\n\n## When to use this\n\n## Steps\n1. \n`;

const cleanName = (raw: string) => raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "").slice(0, 64);

export function SkillsSheet({ scope, ownerId, name }: { scope?: SkillScope; ownerId?: string | null; name?: string }) {
  const agents = useStore((s) => s.agents);
  const team = useStore((s) => s.team);
  const stamp = useStore((s) => s.skillsStamp);
  const [skills, setSkills] = useState<Skill[] | null>(null);
  const [selected, setSelected] = useState<{ scope: SkillScope; ownerId: string | null; name: string } | null>(
    scope && name ? { scope, ownerId: ownerId ?? null, name } : null,
  );
  const [installing, setInstalling] = useState<Shelf | null>(null);
  const [query, setQuery] = useState("");
  const [dataDir, setDataDir] = useState("");

  const shelves: Shelf[] = useMemo(
    () => [
      { key: "user", scope: "user", ownerId: null, label: "All teams", sub: "every agent, every team" },
      { key: "team", scope: "team", ownerId: null, label: team?.name ?? "This team", sub: "every agent on this team" },
      ...agents.map((a) => ({ key: `agent:${a.id}`, scope: "agent" as SkillScope, ownerId: a.id, label: a.name, sub: a.role })),
    ],
    [agents, team],
  );

  const load = () => store.rpc<Skill[]>("skills.list").then(setSkills);
  useEffect(() => { void load(); }, [stamp]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void window.crew.dataDir().then(setDataDir); }, []);

  const current = (selected && skills?.find((s) => s.name === selected.name && s.scope === selected.scope && (s.scope !== "agent" || s.ownerId === selected.ownerId))) ?? null;
  const q = query.trim().toLowerCase();
  const matches = (s: Skill) => !q || s.name.includes(q) || s.description.toLowerCase().includes(q);

  const create = async (shelf: Shelf, skillName: string, description: string) => {
    await store.rpc("skills.save", { scope: shelf.scope, ownerId: shelf.ownerId, name: skillName, content: STARTER(skillName, description) });
    setInstalling(null);
    setSelected({ scope: shelf.scope, ownerId: shelf.ownerId, name: skillName });
  };

  return (
    <div className="sheet" style={{ width: 900, height: 720 }}>
      <div style={{ flexShrink: 0, background: "#efede8" }}>
        <div style={{ height: 40, display: "flex", alignItems: "center", padding: "0 16px", gap: 10 }}>
          <Ic.Sparkle size={16} stroke="var(--accent)" />
          <b style={{ fontWeight: 600 }}>Skills</b>
          <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>How-tos your agents can open when they apply</span>
          <span className="grow" />
          <SearchField placeholder="Search skills" value={query} onChange={setQuery} width={180} />
          <IconButton onClick={() => store.closeSheet()}><Ic.X size={14} /></IconButton>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "252px minmax(0, 1fr)" }}>
        <div className="scroll" style={{ borderRight: "1px solid var(--border)", background: "var(--bg)", padding: "6px 0" }}>
          {shelves.map((shelf) => {
            const mine = (skills ?? []).filter((s) => onShelf(s, shelf)).filter(matches);
            const agent = agents.find((a) => a.id === shelf.ownerId);
            return (
              <div key={shelf.key} style={{ marginBottom: 6 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px 3px" }}>
                  {agent ? <Avatar agent={agent} size={14} /> : <Ic.Team size={13} stroke="var(--ink-4)" />}
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-5)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shelf.label}</span>
                  <IconButton title={`Add a skill for ${shelf.label}`} onClick={() => setInstalling(shelf)}><Ic.Plus size={11} /></IconButton>
                </div>
                {mine.length === 0 && <div style={{ padding: "2px 10px 6px 28px", fontSize: 11, color: "var(--ink-5)" }}>{q ? "No match" : `None — ${shelf.sub}`}</div>}
                {mine.map((s) => {
                  const on = current === s;
                  return (
                    <button
                      key={s.name}
                      className={"li" + (on ? " li-sel" : "")}
                      style={{ padding: "5px 10px 5px 28px", flexDirection: "column", gap: 1, alignItems: "flex-start" }}
                      onClick={() => { setInstalling(null); setSelected({ scope: s.scope, ownerId: s.ownerId, name: s.name }); }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 5, width: "100%" }}>
                        <span className="mono" style={{ fontSize: 12, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                        {s.errors.length > 0 && <span className="dot" style={{ width: 6, height: 6, background: "var(--red)" }} title={s.errors[0]} />}
                      </span>
                      <span style={{ fontSize: 10.5, color: "var(--ink-5)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>{s.description || "No description"}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
          {skills === null && <div style={{ padding: 10, fontSize: 12, color: "var(--ink-4)" }}>Loading…</div>}
        </div>

        <div className="scroll" style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
          {installing ? (
            <InstallPanel shelf={installing} onDone={() => setInstalling(null)} onCreate={(n, d) => void create(installing, n, d)} />
          ) : current ? (
            <SkillDetail key={`${current.scope}:${current.ownerId}:${current.name}`} skill={current} shelves={shelves} onGone={() => setSelected(null)} onMoved={(t) => setSelected({ scope: t.scope, ownerId: t.ownerId, name: current.name })} />
          ) : (
            <Empty shelves={shelves} onPick={setInstalling} />
          )}
        </div>
      </div>

      <div className="sheet-f" style={{ height: 48 }}>
        <span style={{ fontSize: 12, color: "var(--ink-4)" }} className="cell">
          Skills folder: <span className="mono sel">{dataDir ? `${dataDir}/skills` : ""}</span>
          {dataDir && <> · <a onClick={() => void window.crew.openPath(`${dataDir}/skills`)}>Show in Finder</a></>}
        </span>
        <span className="grow" />
        <Button primary onClick={() => store.closeSheet()}>Done</Button>
      </div>
    </div>
  );
}

// ---------- nothing selected ----------

function Empty({ shelves, onPick }: { shelves: Shelf[]; onPick: (s: Shelf) => void }) {
  return (
    <div style={{ margin: "auto", maxWidth: 460, textAlign: "center", display: "flex", flexDirection: "column", gap: 12, alignItems: "center", color: "var(--ink-4)" }}>
      <Ic.Sparkle size={26} stroke="var(--ink-5)" />
      <div style={{ fontSize: 13, lineHeight: 1.5 }}>
        A skill is a folder with a <span className="mono">SKILL.md</span> in it — the same format Claude Code uses, so anything you already have works here.
        Only the name and description sit in an agent's prompt; it opens the rest when the work calls for it.
      </div>
      <div style={{ fontSize: 12, lineHeight: 1.5 }}>
        Put a skill on <b>All teams</b> and every agent everywhere gets it. Put it on a team, or on one agent, when only they should.
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap", justifyContent: "center" }}>
        {shelves.slice(0, 2).map((s) => (
          <Button key={s.key} icon={<Ic.Plus size={11} />} onClick={() => onPick(s)}>Add to {s.label}</Button>
        ))}
      </div>
    </div>
  );
}

// ---------- one skill ----------

function SkillDetail({ skill, shelves, onGone, onMoved }: { skill: Skill; shelves: Shelf[]; onGone: () => void; onMoved: (t: Shelf) => void }) {
  const [text, setText] = useState(skill.content);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setText(skill.content); }, [skill.content]);
  const target = { scope: skill.scope, ownerId: skill.ownerId };
  const dirty = text !== skill.content;
  const here = shelves.find((s) => onShelf(skill, s));

  const save = async () => {
    await store.rpc("skills.save", { ...target, name: skill.name, content: text });
    store.toast("Skill saved.");
  };
  const remove = async () => {
    if (!confirm(`Delete "${skill.name}"? The folder and everything in it is removed.`)) return;
    await store.rpc("skills.delete", { ...target, name: skill.name });
    onGone();
  };
  const update = async () => {
    setBusy(true);
    try { await store.rpc("skills.update", { ...target, name: skill.name }); store.toast(`Pulled the latest ${skill.name}.`); }
    catch (e) { store.toast(msg(e)); }
    finally { setBusy(false); }
  };
  const move = async (key: string) => {
    const to = shelves.find((s) => s.key === key);
    if (!to) return;
    await store.rpc("skills.move", { from: target, to: { scope: to.scope, ownerId: to.ownerId }, name: skill.name });
    onMoved(to);
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>{skill.name}</div>
          <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 2 }}>{skill.description || "No description — agents will not know when to use this."}</div>
        </div>
        <Popup value={here?.key ?? "user"} options={shelves.map((s) => ({ value: s.key, label: s.label }))} onChange={(v) => void move(v)} style={{ width: 150 }} />
      </div>

      {skill.errors.length > 0 && (
        <div style={{ background: "var(--red-bg)", color: "var(--red-ink)", borderRadius: 6, padding: "8px 10px", fontSize: 12, lineHeight: 1.5 }}>
          <b>Not usable yet.</b> No agent is offered this skill until it is fixed.
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>{skill.errors.map((e) => <li key={e}>{e}</li>)}</ul>
        </div>
      )}

      <div style={{ fontSize: 11.5, color: "var(--ink-4)", display: "flex", flexWrap: "wrap", gap: 10 }}>
        <span>{sourceLine(skill)} · updated {new Date(skill.updatedAt).toLocaleDateString([], { month: "short", day: "numeric" })}</span>
        <span className="grow" />
        <a onClick={() => void window.crew.openPath(skill.dir)}>Show in Finder</a>
      </div>

      <textarea className="field mono" spellCheck={false} style={{ flex: 1, minHeight: 280, width: "100%" }} value={text} onChange={(e) => setText(e.target.value)} />

      {skill.files.length > 0 && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--surface)", padding: "8px 10px" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "var(--ink-5)", marginBottom: 4 }}>Bundled files</div>
          <div style={{ fontSize: 11.5, color: "var(--ink-3)", display: "flex", flexWrap: "wrap", gap: "2px 12px" }}>
            {skill.files.map((f) => <span key={f} className="mono">{f}</span>)}
          </div>
          <div style={{ fontSize: 11, color: "var(--ink-4)", marginTop: 5 }}>Agents may read and run these while the skill is open, even though they sit outside the workspace.</div>
        </div>
      )}

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <Button danger onClick={() => void remove()}>Delete</Button>
        {skill.source.ref && <Button disabled={busy} onClick={() => void update()}>{busy ? "Updating…" : "Update from source"}</Button>}
        <span className="grow" />
        {dirty && <Button onClick={() => setText(skill.content)}>Revert</Button>}
        <Button primary disabled={!dirty} onClick={() => void save()}>Save</Button>
      </div>
    </>
  );
}

function sourceLine(s: Skill): string {
  const { kind, ref, version } = s.source;
  if (kind === "learned") return "Written by the agent";
  if (kind === "bundled") return "Ships with StandBye";
  if (kind === "manual" || !ref) return "Written here";
  if (kind === "git") return `From ${ref}${version ? ` @ ${version}` : ""}`;
  if (kind === "claude-code") return `Imported from Claude Code`;
  return `From ${ref}`;
}

// ---------- installing ----------

/** Every way to get a skill onto a shelf. "write" is the only one that is not a copy from somewhere. */
type Source = SkillInstallKind | "write";

const SOURCES: { value: Source; label: string }[] = [
  { value: "claude-code", label: "On this Mac" },
  { value: "git", label: "GitHub" },
  { value: "folder", label: "Folder" },
  { value: "zip", label: "Zip" },
  { value: "write", label: "Write one" },
];

function InstallPanel({ shelf, onDone, onCreate }: { shelf: Shelf; onDone: () => void; onCreate: (name: string, description: string) => void }) {
  const [kind, setKind] = useState<Source>("claude-code");
  const [ref, setRef] = useState("");
  const [draft, setDraft] = useState({ name: "", description: "" });
  const [origins, setOrigins] = useState<SkillOrigin[] | null>(null);
  const [scan, setScan] = useState<SkillSourceScan | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { void store.rpc<SkillOrigin[]>("skills.origins").then(setOrigins); }, []);
  useEffect(() => { setScan(null); setError(null); setRef(""); }, [kind]);

  const doScan = async (from: string) => {
    if (kind === "write") return;
    setRef(from);
    setBusy(true); setError(null); setScan(null);
    try {
      const s = await store.rpc<SkillSourceScan>("skills.scan", { kind, ref: from, scope: shelf.scope, ownerId: shelf.ownerId });
      setScan(s);
      setPicked(new Set(s.candidates.filter((c) => !c.errors.length).map((c) => c.name)));
    } catch (e) { setError(msg(e)); }
    finally { setBusy(false); }
  };

  const browse = async () => {
    const p = kind === "zip" ? await window.crew.pickFile(["zip", "skill"], "Skill archive") : await window.crew.pickFolder();
    if (p) await doScan(p);
  };

  const install = async () => {
    if (!scan) return;
    setBusy(true); setError(null);
    try {
      const out = await store.rpc<{ installed: unknown[]; skipped: { name: string; reason: string }[] }>("skills.install", {
        kind, ref, scope: shelf.scope, ownerId: shelf.ownerId, names: [...picked],
      });
      store.toast(`Installed ${out.installed.length} skill${out.installed.length === 1 ? "" : "s"} for ${shelf.label}.`);
      onDone();
    } catch (e) { setError(msg(e)); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Add a skill to {shelf.label}</div>
          <div style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{shelf.sub}</div>
        </div>
        <IconButton onClick={onDone} title="Close"><Ic.X size={12} /></IconButton>
      </div>

      <Segmented value={kind} options={SOURCES} onChange={setKind} />

      {kind === "write" && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--surface)", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          <input className="field mono" placeholder="release-checklist" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <textarea
            className="field" style={{ minHeight: 60 }} placeholder="What it does and when an agent should reach for it. This line is all an agent sees until it opens the skill, so be specific."
            value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span className="mono" style={{ fontSize: 11, color: "var(--ink-5)" }}>{cleanName(draft.name) || "name"}/SKILL.md</span>
            <span className="grow" />
            <Button primary disabled={!cleanName(draft.name) || draft.description.trim().length < 10} onClick={() => onCreate(cleanName(draft.name), draft.description.trim())}>Create and edit</Button>
          </div>
        </div>
      )}

      {kind === "claude-code" && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--surface)", overflow: "hidden" }}>
          {origins === null && <div style={{ padding: 10, fontSize: 12, color: "var(--ink-4)" }}>Looking…</div>}
          {origins?.length === 0 && (
            <div style={{ padding: 10, fontSize: 12, color: "var(--ink-4)", lineHeight: 1.5 }}>
              No skills found in <span className="mono">~/.claude/skills</span> or your Claude Code plugins. Install one there, or use one of the other sources.
            </div>
          )}
          {origins?.map((o) => (
            <div key={o.path} className="rule">
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 12 }}>{o.label}</span>
                <span className="mono" style={{ display: "block", fontSize: 10.5, color: "var(--ink-5)", overflow: "hidden", textOverflow: "ellipsis" }}>{o.path}</span>
              </span>
              <span style={{ fontSize: 11, color: "var(--ink-4)" }}>{o.count} skill{o.count === 1 ? "" : "s"}</span>
              <Button sm onClick={() => void doScan(o.path)}>Browse</Button>
            </div>
          ))}
        </div>
      )}

      {kind === "git" && (
        <div style={{ display: "flex", gap: 6 }}>
          <input
            className="field mono" style={{ flex: 1 }} placeholder="anthropics/skills  ·  owner/repo/path/to/skill  ·  a GitHub URL"
            value={ref} onChange={(e) => setRef(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ref.trim() && void doScan(ref.trim())}
          />
          <Button disabled={!ref.trim() || busy} onClick={() => void doScan(ref.trim())}>{busy ? "Fetching…" : "Fetch"}</Button>
        </div>
      )}

      {(kind === "folder" || kind === "zip") && (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input className="field mono" style={{ flex: 1 }} placeholder={kind === "zip" ? "/path/to/skill.zip" : "/path/to/a/folder of skills"} value={ref} onChange={(e) => setRef(e.target.value)} />
          <Button icon={<Ic.Folder size={11} />} onClick={() => void browse()}>Choose…</Button>
          <Button disabled={!ref.trim() || busy} onClick={() => void doScan(ref.trim())}>{busy ? "Reading…" : "Read"}</Button>
        </div>
      )}

      {error && <div style={{ background: "var(--red-bg)", color: "var(--red-ink)", borderRadius: 6, padding: "8px 10px", fontSize: 12 }}>{error}</div>}

      {scan && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--surface)", overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
          <div style={{ display: "flex", alignItems: "center", height: 28, padding: "0 10px", background: "var(--bg)", borderBottom: "1px solid var(--border)", fontSize: 11, fontWeight: 700, color: "var(--ink-5)", gap: 8 }}>
            <span style={{ flex: 1 }}>Found {scan.candidates.length} skill{scan.candidates.length === 1 ? "" : "s"}</span>
            {scan.version && <span className="mono" style={{ fontWeight: 500 }}>{scan.version}</span>}
          </div>
          <div className="scroll" style={{ maxHeight: 260 }}>
            {scan.candidates.map((c) => <Candidate key={c.subpath + c.name} c={c} picked={picked.has(c.name)} onToggle={() => setPicked(toggle(picked, c.name))} />)}
          </div>
        </div>
      )}

      {scan && (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span style={{ fontSize: 11.5, color: "var(--ink-4)" }}>{picked.size} selected · a name already on this shelf is replaced</span>
          <span className="grow" />
          <Button primary disabled={!picked.size || busy} onClick={() => void install()}>{busy ? "Installing…" : `Install to ${shelf.label}`}</Button>
        </div>
      )}
    </>
  );
}

function Candidate({ c, picked, onToggle }: { c: SkillCandidate; picked: boolean; onToggle: () => void }) {
  const broken = c.errors.length > 0;
  return (
    <div className="rule" style={{ alignItems: "flex-start", paddingTop: 7, paddingBottom: 7 }}>
      <span style={{ paddingTop: 1 }}><Checkbox checked={picked && !broken} onChange={broken ? undefined : onToggle} /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span className="mono" style={{ fontSize: 12, fontWeight: 500 }}>{c.name}</span>
        {c.conflictsWith && <span className="badge" style={{ marginLeft: 6 }}>replaces</span>}
        <span style={{ display: "block", fontSize: 11.5, color: broken ? "var(--red-ink)" : "var(--ink-4)", lineHeight: 1.45 }}>
          {broken ? c.errors[0] : c.description || "No description"}
        </span>
        {c.subpath && <span className="mono" style={{ display: "block", fontSize: 10.5, color: "var(--ink-5)" }}>{c.subpath}</span>}
      </span>
      {c.files > 0 && <span style={{ fontSize: 11, color: "var(--ink-5)", whiteSpace: "nowrap" }}>{c.files} file{c.files === 1 ? "" : "s"}</span>}
    </div>
  );
}

function toggle(set: Set<string>, name: string): Set<string> {
  const next = new Set(set);
  if (next.has(name)) next.delete(name); else next.add(name);
  return next;
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
