/**
 * Provider brand marks, in one place.
 *
 * The app's settings screen and the landing page's marquee both draw these, and the site pulls
 * this file through its `@kit` alias exactly as it pulls the rest of the kit — so a provider
 * always looks the same in both, and there is one list to update rather than two.
 *
 * Artwork comes from `simple-icons` (CC0). Every icon is a *named* import so the bundler keeps
 * only the twenty-odd we use out of its three thousand. A vendor simple-icons does not carry —
 * OpenAI, Groq, Together, Fireworks, AWS, Azure and a handful of young coding agents — falls back
 * to the monogram from the provider catalog. A monogram is better than the wrong company's logo:
 * `siAmp` is Google's AMP, not Sourcegraph's Amp, so Amp gets letters.
 */
import { providerAccent, providerMonogram } from "@crew/shared";
import {
  siAlibabacloud, siCline, siCursor, siClaude, siDeepseek, siGithubcopilot, siGooglecloud, siGooglegemini,
  siKimi, siLmstudio, siMinimax, siMistralai, siMoonshotai, siOllama, siOpencode, siOpenrouter, siQwen, siWarp,
  siX, siZdotai, type SimpleIcon,
} from "simple-icons";

/** Provider id → the vendor's real mark. Absent means "draw the monogram". */
const ICONS: Record<string, SimpleIcon> = {
  anthropic: siClaude,
  openrouter: siOpenrouter,
  // coding agents
  copilot: siGithubcopilot,
  cursor: siCursor,
  opencode: siOpencode,
  vibe: siMistralai,
  "kimi-cli": siMoonshotai,
  cline: siCline,
  warp: siWarp,
  // coding plans
  minimax: siMinimax,
  deepseek: siDeepseek,
  moonshot: siKimi,
  zai: siZdotai,
  // keys
  google: siGooglegemini,
  xai: siX,
  mistral: siMistralai,
  qwen: siQwen,
  // clouds and local
  vertex: siGooglecloud,
  ollama: siOllama,
  lmstudio: siLmstudio,
};

export function providerIcon(id: string): SimpleIcon | undefined {
  return ICONS[id];
}

/** Brands whose own colour is near-black, which disappears on a dark surface. */
function isInk(hex: string): boolean {
  return ["000000", "181717", "191919", "18181B", "0F0F0F", "2D2D2D"].includes(hex.toUpperCase());
}

/**
 * `tile` — a solid rounded square in the provider's colour with a white glyph, the way an app
 * icon reads in a list. `plain` — the bare mark in the vendor's own colour, which is what the
 * site's marquee chips want.
 */
export function ProviderMark({ id, size = 18, variant = "tile" }: { id: string; size?: number; variant?: "tile" | "plain" }) {
  const icon = ICONS[id];

  if (variant === "plain") {
    if (icon) {
      return (
        <svg viewBox="0 0 24 24" width={size} height={size} role="img" aria-label={icon.title}>
          <path d={icon.path} fill={isInk(icon.hex) ? "var(--ink)" : `#${icon.hex}`} />
        </svg>
      );
    }
    return <span className="brand-mono" style={{ background: providerAccent(id) }}>{providerMonogram(id)}</span>;
  }

  // The tile colour comes from the catalog rather than the icon, because nine of these brands are
  // black and a settings list of black squares tells you nothing. The glyph is still theirs.
  return (
    <span
      aria-label={icon?.title ?? id}
      style={{
        width: size, height: size, borderRadius: Math.max(4, Math.round(size * 0.24)), flexShrink: 0,
        background: providerAccent(id), color: "#fff",
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        fontSize: size * 0.46, fontWeight: 700, letterSpacing: -0.2,
      }}
    >
      {icon
        ? <svg viewBox="0 0 24 24" width={size * 0.62} height={size * 0.62} role="img" aria-hidden><path d={icon.path} fill="#fff" /></svg>
        : providerMonogram(id)}
    </span>
  );
}
