// "Bring what you already pay for": every provider, subscription and coding plan an agent can run on, as two
// auto-scrolling rows. Research and per-vendor notes: docs/research/providers.md. Brand marks come from the
// simple-icons package (CC0); vendors it does not carry get a monogram in the vendor's colour.
import {
  siAlibabacloud, siAmp, siAnthropic, siClaude, siCline, siCursor, siDeepseek, siGithubcopilot, siGoogle, siGooglecloud,
  siKimi, siLmstudio, siMinimax, siMistralai, siMoonshotai, siOllama, siOpenrouter, siWarp, siX, type SimpleIcon,
} from "simple-icons";
import snapshot from "./openrouter.json";

type Entry = { name: string; by: string; via: string; url: string; icon?: SimpleIcon; mark?: React.ReactNode };

const mono = (text: string, color: string) => <span className="brand-mono" style={{ background: color }}>{text}</span>;

// Row one: logins and subscriptions. Row two: coding plans, clouds, local and plain keys.
const ROW_A: Entry[] = [
  { name: "Claude Code", by: "Anthropic", via: "Your Claude Pro or Max login", url: "https://code.claude.com/docs/en/agent-sdk", icon: siClaude },
  { name: "Anthropic API", by: "Anthropic", via: "Every Claude model by key", url: "https://console.anthropic.com", icon: siAnthropic },
  { name: "OpenRouter", by: "OpenRouter", via: `${snapshot.total} tool-capable models from ${snapshot.vendors.length} labs`, url: "https://openrouter.ai", icon: siOpenrouter },
  { name: "Codex", by: "OpenAI", via: "ChatGPT plan or API key", url: "https://learn.chatgpt.com/docs/non-interactive-mode", mark: mono("O", "#10a37f") },
  { name: "GitHub Copilot", by: "GitHub", via: "GitHub login, Copilot SDK", url: "https://github.com/github/copilot-sdk", icon: siGithubcopilot },
  { name: "Cursor", by: "Cursor", via: "Cursor plan or API key", url: "https://cursor.com/docs/cli/headless", icon: siCursor },
  { name: "OpenCode", by: "Anomaly", via: "ChatGPT and Copilot OAuth, any key", url: "https://opencode.ai/docs/cli", mark: mono("OC", "#1d1c1a") },
  { name: "Droid", by: "Factory", via: "Factory plan or key", url: "https://docs.factory.ai/droid-exec/overview", mark: mono("F", "#0f172a") },
  { name: "Amp", by: "Amp", via: "Amp account", url: "https://ampcode.com/docs/cli/execute-mode", icon: siAmp },
  { name: "Mistral Vibe", by: "Mistral", via: "Le Chat Pro or API key", url: "https://docs.mistral.ai/vibe/code/cli", icon: siMistralai },
  { name: "Kimi Code CLI", by: "Moonshot", via: "Kimi membership or key", url: "https://moonshotai.github.io/kimi-cli", icon: siMoonshotai },
  { name: "Goose", by: "AAIF", via: "Keys, subscriptions via ACP", url: "https://goose-docs.ai", mark: mono("G", "#3b4a8c") },
  { name: "Cline", by: "Cline", via: "Cline credits or your keys", url: "https://docs.cline.bot/cline-cli/overview", icon: siCline },
  { name: "Kilo", by: "Kilo", via: "Kilo Pass or your keys", url: "https://kilo.ai/docs/code-with-ai/platforms/cli", mark: mono("K", "#6d28d9") },
  { name: "Devin", by: "Cognition", via: "Devin plan", url: "https://docs.devin.ai/cli/reference/commands", mark: mono("D", "#0ea5e9") },
  { name: "Warp", by: "Warp", via: "Warp plan or key", url: "https://docs.warp.dev/reference/cli", icon: siWarp },
  { name: "Auggie", by: "Augment", via: "Augment plan", url: "https://docs.augmentcode.com/cli/reference", mark: mono("A", "#16a34a") },
];

const ROW_B: Entry[] = [
  { name: "MiniMax", by: "Token Plan", via: "M3 on api.minimax.io/anthropic", url: "https://platform.minimax.io/docs/token-plan/other-tools", icon: siMinimax },
  { name: "DeepSeek", by: "V4 Pro and Flash", via: "api.deepseek.com/anthropic", url: "https://api-docs.deepseek.com/guides/anthropic_api", icon: siDeepseek },
  { name: "Kimi Code", by: "Moonshot", via: "K3 on a Kimi membership", url: "https://www.kimi.com/code/docs/en/third-party-tools/claude-code.html", icon: siKimi },
  { name: "GLM Coding Plan", by: "Z.ai", via: "GLM 5.3 on a plan", url: "https://docs.z.ai/devpack/overview", mark: mono("Z", "#2563eb") },
  { name: "Ollama", by: "local or cloud", via: "Models on your own Mac", url: "https://docs.ollama.com/api/anthropic-compatibility", icon: siOllama },
  { name: "LM Studio", by: "local", via: "Models on your own Mac", url: "https://lmstudio.ai/docs/developer/anthropic-compat/messages", icon: siLmstudio },
  { name: "Amazon Bedrock", by: "AWS", via: "Claude through your AWS account", url: "https://code.claude.com/docs/en/amazon-bedrock", mark: mono("aws", "#ff9900") },
  { name: "Vertex AI", by: "Google Cloud", via: "Claude through your GCP project", url: "https://code.claude.com/docs/en/google-vertex-ai", icon: siGooglecloud },
  { name: "Azure AI Foundry", by: "Microsoft", via: "Claude and OpenAI through Azure", url: "https://code.claude.com/docs/en/microsoft-foundry", mark: mono("Az", "#0078d4") },
  { name: "OpenAI API", by: "OpenAI", via: "GPT-5.5 and gpt-oss by key", url: "https://platform.openai.com", mark: mono("O", "#10a37f") },
  { name: "Google AI Studio", by: "Google", via: "Gemini by key", url: "https://aistudio.google.com", icon: siGoogle },
  { name: "xAI", by: "Grok", via: "OpenAI-compatible, by key", url: "https://x.ai/api", icon: siX },
  { name: "Mistral API", by: "Mistral", via: "Devstral and Mistral Large", url: "https://console.mistral.ai", icon: siMistralai },
  { name: "Qwen", by: "Alibaba Model Studio", via: "Qwen 3.7 by key", url: "https://modelstudio.console.alibabacloud.com", icon: siAlibabacloud },
  { name: "Groq · Together · Fireworks", by: "inference clouds", via: "Fast open-weight models", url: "https://console.groq.com", mark: mono("⚡", "#f55036") },
];

function Brand({ e }: { e: Entry }) {
  if (e.icon) {
    const dark = ["000000", "181717", "191919", "18181B"].includes(e.icon.hex);
    return (
      <span className="pbrand">
        <svg viewBox="0 0 24 24" width="18" height="18" role="img" aria-label={e.icon.title}>
          <path d={e.icon.path} fill={dark ? "var(--ink)" : `#${e.icon.hex}`} />
        </svg>
      </span>
    );
  }
  return <span className="pbrand">{e.mark ?? <span className="brand-mono" style={{ background: "var(--ink-4)" }}>{e.name.charAt(0)}</span>}</span>;
}

function Row({ items, reverse }: { items: Entry[]; reverse?: boolean }) {
  // The track holds the list twice so the loop is seamless; the second copy is hidden from assistive tech.
  return (
    <div className={"marquee" + (reverse ? " marquee-rev" : "")}>
      <div className="marquee-track">
        {[0, 1].map((copy) => (
          <div key={copy} className="marquee-run" aria-hidden={copy === 1}>
            {items.map((e) => (
              <a key={e.name} className="ptile" href={e.url} target="_blank" rel="noreferrer" tabIndex={copy === 1 ? -1 : 0} title={e.via}>
                <Brand e={e} />
                <span className="ptile-t">
                  <span className="ptile-n">{e.name}</span>
                  <span className="ptile-v">{e.by} · {e.via}</span>
                </span>
              </a>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Providers() {
  const total = ROW_A.length + ROW_B.length;
  return (
    <section id="providers" className="sec-block alt-bg prov-band">
      <div className="wrap wrap-wide">
        <h2 style={{ textAlign: "center" }}>Bring what you already pay for</h2>
        <p className="muted" style={{ textAlign: "center", maxWidth: 720, margin: "0 auto 22px" }}>
          A ChatGPT plan, a Copilot seat, a Cursor subscription, a coding plan from one of the labs, a model on your own Mac. {total} ways in, one team,
          the same tools and guardrails whichever you pick.
        </p>
      </div>
      <Row items={ROW_A} />
      <Row items={ROW_B} reverse />
      <div className="wrap wrap-wide">
        <div className="fine" style={{ textAlign: "center", marginTop: 14 }}>Hover to pause. Brand marks belong to their owners.</div>
      </div>
    </section>
  );
}
