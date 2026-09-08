import { useEffect, useState, type ReactNode } from "react";
import type { GitInfo, GitSettings } from "@crew/shared";
import { store } from "../state/store";
import { Ic } from "../ui/icons";
import { Popup, Segmented, Switch } from "../ui/kit";

/**
 * Git workflow for a team's workspace. Renders nothing unless the folder is a git repo.
 * Used by the builders (before the team exists) and by Settings.
 */
export function GitSettingsPanel({ workspace, value, onChange, compact }: { workspace: string | null; value: GitSettings | null; onChange: (g: GitSettings | null) => void; compact?: boolean }) {
  const [info, setInfo] = useState<GitInfo | null>(null);
  useEffect(() => {
    let alive = true;
    setInfo(null);
    if (!workspace) { onChange(null); return; }
    void store.rpc<GitInfo>("git.info", { path: workspace }).then(async (i) => {
      if (!alive) return;
      setInfo(i);
      if (!i.isRepo) { onChange(null); return; }
      if (!value) onChange(await store.rpc<GitSettings | null>("git.defaults", { path: workspace }));
    }).catch(() => setInfo({ isRepo: false, currentBranch: null, branches: [], hasRemote: false, remoteUrl: null, hasGh: false }));
    return () => { alive = false; };
  }, [workspace]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!workspace || !info || !info.isRepo) return null;
  const g = value ?? { enabled: false, workBranch: info.currentBranch ?? "main", mode: "push", devBranch: null, stagingBranch: null, productionBranch: null };
  const set = (patch: Partial<GitSettings>) => onChange({ ...g, ...patch });
  const branchOptions = [{ value: "", label: "none" }, ...info.branches.map((b) => ({ value: b, label: b }))];
  const requiredBranchOptions = info.branches.map((b) => ({ value: b, label: b }));
  const remote = info.remoteUrl?.replace(/^.*[:/]([^/]+\/[^/]+?)(\.git)?$/, "$1") ?? null;

  return (
    <div className={"git-panel" + (compact ? " git-compact" : "")}>
      <div className="git-panel-h">
        <Switch on={g.enabled} onChange={(v) => set({ enabled: v })} />
        <div className="git-panel-title">
          <b><Ic.Branch size={13} />Git workflow</b>
          <div className="git-panel-meta">
            <span className="pill git-pill-repo">repo</span>
            <span className="cell">on <span className="mono">{info.currentBranch ?? "?"}</span></span>
            {info.hasRemote && remote ? <span className="cell">{remote}</span> : <span>no remote</span>}
            {info.hasGh && <span className="pill git-pill-gh">gh</span>}
          </div>
        </div>
      </div>
      {g.enabled && (
        <div className="git-panel-body">
          <div className="git-top">
            <Field label="Work on">
              <Popup value={g.workBranch} options={requiredBranchOptions.length ? requiredBranchOptions : [{ value: g.workBranch, label: g.workBranch }]} onChange={(v) => set({ workBranch: v })} />
            </Field>
            <Field label="Changes via">
              <div className="git-seg">
                <Segmented value={g.mode} onChange={(mode) => set({ mode })} options={[{ value: "pr", label: compact ? "PRs" : "Pull requests" }, { value: "push", label: compact ? "Push" : "Direct push" }]} />
              </div>
            </Field>
          </div>
          {!compact && (
            <div className="git-hint">
              {g.mode === "pr"
                ? `Agents branch off ${g.workBranch}, push the feature branch and open a PR with gh. Merging asks you.${info.hasGh ? "" : " gh is not installed on this Mac, so PRs can't be opened yet."}`
                : `Agents commit on ${g.workBranch} and push it when tests pass.`}
            </div>
          )}
          <div className="git-env-block">
            {!compact && <span className="git-env-t">Environments</span>}
            <div className="git-env">
              <Field label="Dev"><Popup value={g.devBranch ?? ""} options={branchOptions} onChange={(v) => set({ devBranch: v || null })} /></Field>
              <Field label="Staging"><Popup value={g.stagingBranch ?? ""} options={branchOptions} onChange={(v) => set({ stagingBranch: v || null })} /></Field>
              <Field label="Production"><Popup value={g.productionBranch ?? ""} options={branchOptions} onChange={(v) => set({ productionBranch: v || null })} /></Field>
            </div>
          </div>
          {!compact && <div className="git-hint">Staging and production are never pushed by agents; promotions come to you as a question. Force pushes are always blocked.</div>}
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="git-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
