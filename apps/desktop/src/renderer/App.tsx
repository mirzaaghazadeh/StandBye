import { store, useStore } from "./state/store";
import { Sidebar } from "./components/Sidebar";
import { HomeScreen } from "./screens/Home";
import { ChannelScreen } from "./screens/Channel";
import { InboxScreen } from "./screens/Inbox";
import { RunsScreen } from "./screens/Runs";
import { AgentSheet } from "./screens/AgentSheet";
import { BuilderSheet } from "./screens/BuilderSheet";
import { KeysSheet } from "./screens/KeysSheet";
import { WakeSheet } from "./screens/WakeSheet";
import { OnboardingSheet } from "./screens/OnboardingSheet";
import { ManualTeamSheet } from "./screens/ManualTeamSheet";
import { ChannelSheet } from "./screens/ChannelSheet";
import { StatusBar } from "./components/StatusBar";
import { Ic } from "./ui/icons";

export function App() {
  const ready = useStore((s) => s.ready);
  const error = useStore((s) => s.error);
  const route = useStore((s) => s.route);
  const sheet = useStore((s) => s.sheet);
  const toast = useStore((s) => s.toast);

  if (!ready) return <div className="app"><div className="side"><div className="side-drag" /></div><div className="main"><div className="empty">Starting the supervisor…</div></div></div>;

  return (
    <div className="app" style={{ position: "relative" }}>
      <Sidebar />
      <div className="main">
        {error && <div style={{ padding: "8px 14px", background: "var(--red-bg)", color: "var(--red-ink)", fontSize: 12 }}>{error}</div>}
        {route.name === "home" && <HomeScreen />}
        {route.name === "agent" && <HomeScreen />}
        {route.name === "channel" && <ChannelScreen channelId={route.channelId} />}
        {route.name === "dm" && <ChannelScreen key={route.agentId} channelId={`dm-${route.agentId}`} dmAgentId={route.agentId} />}
        {route.name === "inbox" && <InboxScreen questionId={route.questionId} />}
        {route.name === "runs" && <RunsScreen runId={route.runId} />}
        <StatusBar />
      </div>

      {sheet.kind !== "none" && <div className="dim" onClick={() => ["keys", "agent", "wake", "channel"].includes(sheet.kind) && store.closeSheet()} />}
      {sheet.kind === "channel" && <ChannelSheet key={sheet.channelId ?? "new"} channelId={sheet.channelId} />}
      {sheet.kind === "onboarding" && <OnboardingSheet />}
      {sheet.kind === "manual" && <ManualTeamSheet />}
      {sheet.kind === "builder" && <BuilderSheet mode={sheet.mode} />}
      {sheet.kind === "keys" && <KeysSheet />}
      {sheet.kind === "agent" && <AgentSheet agentId={sheet.agentId} tab={sheet.tab} />}
      {sheet.kind === "wake" && <WakeSheet agentId={sheet.agentId} />}

      {toast && (
        <div className="toast">
          <Ic.Check size={13} stroke="var(--green)" strokeWidth={2.6} />
          {toast}
        </div>
      )}
    </div>
  );
}
