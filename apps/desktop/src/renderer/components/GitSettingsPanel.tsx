import { useEffect, useState } from "react";
import type { GitInfo, GitSettings } from "@crew/shared";
import { store } from "../state/store";
import { KV, Popup, Segmented, Switch } from "../ui/kit";

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

  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: 7, background: "var(--surface)", padding: "8px 12px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 4, marginBottom: 6 }}>
        <Switch on={g.enabled} onChange={(v) => set({ enabled: v })} />
        <b style={{ fontWeight: 600 }}>Git workflow</b>
        <span style={{ fontSize: 11, color: "var(--ink-4)" }} className="cell">
          repo detected · on {info.currentBranch ?? "?"}{info.hasRemote ? ` · remote ${info.remoteUrl?.replace(/^.*[:/]([^/]+\/[^/]+?)(\.git)?$/, "$1") ?? ""}` : " · no remote"}{info.hasGh ? " · gh available" : ""}
        </span>
      </div>
      {g.enabled && (
        <>
          <KV k="Work on"><Popup value={g.workBranch} options={requiredBranchOptions.length ? requiredBranchOptions : [{ value: g.workBranch, label: g.workBranch }]} onChange={(v) => set({ workBranch: v })} /></KV>
          <KV k="Changes via">
            <Segmented value={g.mode} onChange={(mode) => set({ mode })} options={[{ value: "pr", label: "Pull requests" }, { value: "push", label: "Direct push" }]} />
          </KV>
          {!compact && (
            <div style={{ fontSize: 11, color: "var(--ink-4)", padding: "0 0 6px 102px" }}>
              {g.mode === "pr"
                ? `Agents branch off ${g.workBranch}, push the feature branch and open a PR with gh. Merging asks you.${info.hasGh ? "" : " gh is not installed on this Mac, so PRs can't be opened yet."}`
                : `Agents commit on ${g.workBranch} and push it when tests pass.`}
            </div>
          )}
          <KV k="Dev branch"><Popup value={g.devBranch ?? ""} options={branchOptions} onChange={(v) => set({ devBranch: v || null })} /></KV>
          <KV k="Staging"><Popup value={g.stagingBranch ?? ""} options={branchOptions} onChange={(v) => set({ stagingBranch: v || null })} /></KV>
          <KV k="Production"><Popup value={g.productionBranch ?? ""} options={branchOptions} onChange={(v) => set({ productionBranch: v || null })} /></KV>
          {!compact && <div style={{ fontSize: 11, color: "var(--ink-4)", padding: "0 0 6px 102px" }}>Staging and production are never pushed by agents; promotions come to you as a question. Force pushes are always blocked.</div>}
        </>
      )}
    </div>
  );
}
