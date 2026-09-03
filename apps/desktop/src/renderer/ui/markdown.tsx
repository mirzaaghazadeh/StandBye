import type { ReactNode } from "react";

/**
 * The little bit of Markdown agents actually write.
 *
 * They write to each other the way engineers do — `file.ts:42`, **blockers**, bulleted findings,
 * a fenced diff — and until now the channel printed the asterisks and backticks literally, which
 * made a careful review read like noise. This renders that subset and nothing else: no HTML is
 * ever interpreted, so a message is text, not markup, whoever wrote it.
 *
 * Every block carries `dir="auto"`, which matters here — a review can be Persian prose quoting
 * English identifiers, and only the browser can decide which way each block should run.
 */

/** Inline: `code`, **bold**, *italic*, [text](url), and bare links. Code wins, so `**x**` stays literal. */
function inline(text: string, key: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\*[^*\n]+\*|_[^_\n]+_)|(\[[^\]\n]+\]\((https?:\/\/[^)\s]+)\))|(https?:\/\/[^\s<>()]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let n = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${n++}`;
    if (m[1]) out.push(<code key={k} className="md-code">{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{m[2].slice(2, -2)}</strong>);
    else if (m[3]) out.push(<em key={k}>{m[3].slice(1, -1)}</em>);
    else if (m[4]) out.push(<a key={k} href={m[5]} target="_blank" rel="noreferrer">{m[4].slice(1, m[4].indexOf("]"))}</a>);
    else if (m[6]) out.push(<a key={k} href={m[6]} target="_blank" rel="noreferrer">{m[6]}</a>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const BULLET = /^\s*([-*+•·])\s+(.*)$/;
const NUMBER = /^\s*(\d+)[.)]\s+(.*)$/;
const HEADING = /^\s*(#{1,4})\s+(.*)$/;

/** Render a message body. Falls back to plain text for anything it does not know. */
export function Rich({ text }: { text: string }): ReactNode {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let fence: { lang: string; lines: string[] } | null = null;
  let k = 0;

  const flushPara = (): void => {
    if (!para.length) return;
    blocks.push(<p key={`p${k++}`} className="md-p" dir="auto">{inline(para.join("\n"), `p${k}`)}</p>);
    para = [];
  };
  const flushList = (): void => {
    if (!list) return;
    const items = list.items.map((t, i) => <li key={i} dir="auto">{inline(t, `l${k}-${i}`)}</li>);
    blocks.push(list.ordered ? <ol key={`o${k++}`} className="md-list">{items}</ol> : <ul key={`u${k++}`} className="md-list">{items}</ul>);
    list = null;
  };

  for (const line of lines) {
    if (fence) {
      if (/^\s*```/.test(line)) {
        blocks.push(<pre key={`c${k++}`} className="md-pre"><code>{fence.lines.join("\n")}</code></pre>);
        fence = null;
      } else fence.lines.push(line);
      continue;
    }
    if (/^\s*```/.test(line)) { flushPara(); flushList(); fence = { lang: line.replace(/^\s*```/, "").trim(), lines: [] }; continue; }

    if (!line.trim()) { flushPara(); flushList(); continue; }

    const h = HEADING.exec(line);
    if (h) { flushPara(); flushList(); blocks.push(<div key={`h${k++}`} className="md-h" dir="auto">{inline(h[2]!, `h${k}`)}</div>); continue; }

    const b = BULLET.exec(line);
    if (b) {
      flushPara();
      if (list && list.ordered) flushList();
      list ??= { ordered: false, items: [] };
      list.items.push(b[2]!);
      continue;
    }
    const num = NUMBER.exec(line);
    if (num) {
      flushPara();
      if (list && !list.ordered) flushList();
      list ??= { ordered: true, items: [] };
      list.items.push(num[2]!);
      continue;
    }
    // A continuation line under a bullet belongs to that bullet, not to a new paragraph.
    if (list && /^\s{2,}\S/.test(line)) { list.items[list.items.length - 1] += "\n" + line.trim(); continue; }

    flushList();
    para.push(line);
  }
  if (fence) blocks.push(<pre key={`c${k++}`} className="md-pre"><code>{fence.lines.join("\n")}</code></pre>);
  flushPara();
  flushList();
  return <>{blocks}</>;
}
