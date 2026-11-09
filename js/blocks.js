// Lesson texts as blocks you can scan, instead of a wall of text. Nothing is
// rewritten: the Markdown of a lesson is read line by line and laid out as
//   - "In breve": the short lines that open a lesson (reminders, what to do today);
//   - "Link": every link of the text, gathered at the top as buttons;
//   - sections that open and close, one per heading, with a clickable outline
//     on top (the lesson's own "TABLE OF CONTENTS" is dropped: the outline is it);
//   - numbered steps (①②③, "1. **Title** — text") as step cards;
//   - lists of short words, and "Avoid: a · b · c" lines, as chips;
//   - warnings ("DO NOT", ‼️) as a callout.
// Everything else stays a paragraph or a list.
import { inline } from './md.js';
import { esc } from './util.js';

const URL_RE = /(https?:\/\/[^\s<>()]+)/;
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩';

// A readable name for a link without one.
function siteName(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    if (h === 'docs.google.com') return 'Documento Google';
    if (h === 'amzn.to' || h.startsWith('amazon.')) return 'Amazon';
    if (h === 'youtu.be' || h.endsWith('youtube.com')) return 'Video YouTube';
    if (h.endsWith('skool.com')) return 'Lezione su Skool';
    return h;
  } catch {
    return url;
  }
}

// "ALL CAPS TITLE" → "All caps title"; mixed case stays as it is.
function tidyTitle(t) {
  // The outline numbers the sections itself: drop "①", "1." or "4." at the start.
  t = t.replace(/[:：]\s*$/, '').replace(/\*\*/g, '').trim().replace(/^(?:[①-⑩]|\d+[.)])\s*/, '');
  if (/[a-zà-ü]/.test(t) || !/[A-Z]/.test(t)) return t;
  const lower = t.toLowerCase();
  const i = lower.search(/[a-zà-ü]/);
  const out = i < 0 ? lower : lower.slice(0, i) + lower[i].toUpperCase() + lower.slice(i + 1);
  return out.replace(/\bi\b/g, 'I').replace(/\bai\b/g, 'AI');
}

// One line → { type, ... }
function classify(line) {
  const t = line.trim();
  if (!t) return null;
  if (/^#{1,6}\s/.test(t)) return { type: 'heading', text: t.replace(/^#+\s*/, '') };
  // A link on its own, with or without a label ("Habit Tracker: https://…").
  const link = t.replace(/^[-•]\s*/, '').match(/^(?:(.{1,60}?)\s*(?::|→|—|-)\s*)?\[?(https?:\/\/[^\s\])]+)\]?(?:\([^)]*\))?\s*$/);
  if (link) return { type: 'link', label: link[1] ? link[1].replace(/\*\*/g, '').trim() : '', url: link[2].replace(/[.,;]+$/, '') };
  if (CIRCLED.includes(t[0])) return { type: 'step', n: CIRCLED.indexOf(t[0]) + 1, text: t.slice(1).trim() };
  if (/^\d+\.\s/.test(t)) return { type: 'ol', n: parseInt(t, 10), text: t.replace(/^\d+\.\s*/, '') };
  if (/^[-•]\s/.test(t)) return { type: 'li', text: t.replace(/^[-•]\s*/, '') };
  // "Avoid: a · b · c" or just "a · b · c · d": chips.
  if ((t.match(/ · /g) || []).length >= 2 && !URL_RE.test(t)) {
    const m = t.match(/^([^:·]{1,30}):\s*(.+)$/);
    return { type: 'chips', label: m ? m[1] : '', items: (m ? m[2] : t).split(/\s+·\s+/) };
  }
  // A bold title, alone or followed by its text ("**Title** — text").
  const bold = t.match(/^\*\*([^*]+)\*\*(.*)$/);
  // (a long sentence all in bold is emphasis, not a title: it stays a paragraph)
  if (bold && bold[1].length <= 90) {
    const rest = bold[2].trim();
    if (!rest || /^[^\p{L}\p{N}]*$/u.test(rest)) return { type: 'sub', text: bold[1] + (rest ? ' ' + rest : '') };
    if (/^[—–-]\s/.test(rest) || /^\p{Lu}/u.test(rest)) return { type: 'sub', text: bold[1], rest: rest.replace(/^[—–-]\s*/, '') };
  }
  if (/‼️|🚨|\bDO NOT\b|\bIMPORTANT\b/.test(t)) return { type: 'warn', text: t };
  return { type: 'p', text: t };
}

// A step's own title and text: "**Pause anytime** — Find a tender spot…"
function stepParts(text) {
  const m = text.match(/^\*\*([^*]+)\*\*\s*(?:[—–-]\s*)?(.*)$/);
  return m ? { title: m[1], body: m[2] } : { title: '', body: text };
}

// Groups the lines of a lesson into sections of blocks.
function parse(src) {
  const sections = [{ title: '', blocks: [] }];
  const links = [];
  let last = null;
  const push = (b) => {
    const sec = sections[sections.length - 1];
    const prev = sec.blocks[sec.blocks.length - 1];
    if (prev && prev.type === b.type && ['li', 'ol', 'step'].includes(b.type)) prev.items.push(b);
    else if (prev && prev.type === 'p' && b.type === 'p' && !last?.gap) prev.lines.push(b.text);
    else if (b.type === 'p') sec.blocks.push({ type: 'p', lines: [b.text] });
    else if (['li', 'ol', 'step'].includes(b.type)) sec.blocks.push({ type: b.type, items: [b] });
    else sec.blocks.push(b);
  };
  for (const raw of src.replace(/\r/g, '').split('\n')) {
    if (!raw.trim()) {
      last = { gap: true };
      continue;
    }
    // A continuation of a list item (indented line).
    const sec = sections[sections.length - 1];
    const prev = sec.blocks[sec.blocks.length - 1];
    if (/^\s{2,}\S/.test(raw) && prev && ['li', 'ol', 'step'].includes(prev.type)) {
      prev.items[prev.items.length - 1].text += ' ' + raw.trim();
      continue;
    }
    const b = classify(raw);
    if (!b) continue;
    if (b.type === 'heading') {
      sections.push({ title: tidyTitle(b.text), blocks: [] });
    } else if (b.type === 'link') {
      if (!links.some((l) => l.url === b.url)) links.push({ label: b.label || siteName(b.url), url: b.url });
    } else {
      push(b);
    }
    last = b;
  }
  // The lesson's own table of contents: the outline replaces it.
  const kept = sections.filter((s) => !/^(table of contents|indice|contents)$/i.test(s.title.replace(/[^a-z ]/gi, '').trim()));
  const intro = kept[0].title ? { title: '', blocks: [] } : kept.shift();
  // A heading with nothing under it is a line said louder, not a section:
  // it goes back as a highlighted note where it was.
  const out = [];
  for (const s of kept) {
    if (s.blocks.length) out.push(s);
    else if (s.title) (out.length ? out[out.length - 1] : intro).blocks.push({ type: 'note', text: s.title });
  }
  return { intro, sections: out, links };
}

const P = (lines) => `<p>${lines.map(inline).join('<br>')}</p>`;

function renderBlock(b) {
  switch (b.type) {
    case 'p':
      return P(b.lines);
    case 'sub':
      return `<h5>${inline(b.text)}</h5>${b.rest ? `<p>${inline(b.rest)}</p>` : ''}`;
    case 'li': {
      const short = b.items.length >= 4 && b.items.every((i) => i.text.length <= 34 && !URL_RE.test(i.text));
      if (short) return `<ul class="chips">${b.items.map((i) => `<li>${inline(i.text)}</li>`).join('')}</ul>`;
      return `<ul>${b.items.map((i) => `<li>${inline(i.text)}</li>`).join('')}</ul>`;
    }
    case 'ol':
    case 'step':
      return `<ol class="steps-list">${b.items
        .map((i, k) => {
          const { title, body } = stepParts(i.text);
          return `<li><span class="num">${i.n || k + 1}</span><div>${title ? `<b>${inline(title)}</b>` : ''}${body ? `<span>${inline(body)}</span>` : ''}</div></li>`;
        })
        .join('')}</ol>`;
    case 'chips':
      return `<div class="chip-row">${b.label ? `<span class="chip-label">${inline(b.label)}</span>` : ''}<ul class="chips">${b.items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul></div>`;
    case 'warn':
      return `<p class="callout warn">${inline(b.text)}</p>`;
    case 'note':
      return `<p class="callout note">${inline(b.text)}</p>`;
    default:
      return '';
  }
}

// The intro: its opening short lines become "In breve"; the rest stays as it is.
function renderIntro(intro) {
  if (!intro || !intro.blocks.length) return '';
  const blocks = [...intro.blocks];
  const brief = [];
  // Short opening lines, plain or all in bold (some classes write them in bold).
  const short = (b) => (b.type === 'p' && b.lines.every((l) => l.length <= 150)) || (b.type === 'sub' && !b.rest && b.text.length <= 150);
  while (blocks.length && short(blocks[0])) {
    const b = blocks.shift();
    brief.push(...(b.type === 'p' ? b.lines : [b.text]));
    if (brief.length >= 6) break;
  }
  let out = '';
  if (brief.length >= 2) out += `<aside class="callout brief"><h4>In breve</h4><ul>${brief.map((l) => `<li>${inline(l)}</li>`).join('')}</ul></aside>`;
  else if (brief.length) blocks.unshift({ type: 'p', lines: brief });
  if (blocks.length) {
    const [first, ...rest] = blocks;
    out += first.type === 'p' ? `<div class="lead">${P(first.lines)}</div>` : renderBlock(first);
    out += rest.map(renderBlock).join('');
  }
  return out;
}

export function lessonBlocks(src) {
  if (!src) return '';
  const { intro, sections, links } = parse(src);
  let out = renderIntro(intro);
  if (links.length) {
    out += `<nav class="resources" aria-label="Link della lezione"><h4>Link</h4><div>${links
      .map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener"><span>${inline(l.label)}</span><small>${esc(siteName(l.url))}</small></a>`)
      .join('')}</div></nav>`;
  }
  if (sections.length) {
    const many = sections.length >= 3;
    if (many) {
      out += `<nav class="outline" aria-label="Sezioni"><div class="outline-head"><h4>Sezioni</h4><button type="button" data-act="sec-all">Apri tutto</button></div><ol>${sections
        .map((s, i) => `<li><button type="button" data-act="sec-open" data-i="${i}">${inline(s.title)}</button></li>`)
        .join('')}</ol></nav>`;
    }
    out += sections
      .map(
        (s, i) => `
      <details class="block" data-i="${i}" ${!many || i === 0 ? 'open' : ''}>
        <summary><span>${inline(s.title || 'Altro')}</span></summary>
        <div class="block-body">${s.blocks.map(renderBlock).join('')}</div>
      </details>`
      )
      .join('');
  }
  return out;
}
