// A small Markdown reader for lesson texts: headings, bold, italic, links,
// bare links, images, bulleted and numbered lists, paragraphs. Everything is
// escaped first, so a lesson can never inject markup.
import { esc } from './util.js';

export function inline(s) {
  let t = esc(s);
  t = t.replace(/!\[([^\]]*)\]\((https?:[^)\s]+)\)/g, '<img src="$2" alt="$1" loading="lazy">');
  t = t.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // Bare links, not those already inside an href or a tag.
  t = t.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, pre, url) => {
    const clean = url.replace(/[.,;:!?]+$/, '');
    return `${pre}<a href="${clean}" target="_blank" rel="noopener">${clean.replace(/^https?:\/\/(www\.)?/, '')}</a>${url.slice(clean.length)}`;
  });
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>');
  t = t.replace(/(^|[^_\w])_([^_\s][^_]*)_(?!\w)/g, '$1<em>$2</em>');
  return t;
}

export function markdown(src) {
  if (!src) return '';
  const out = [];
  for (const block of src.replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const h = block.match(/^(#{1,6})\s+(.*)$/);
    if (h && lines.length === 1) {
      const level = Math.min(Math.max(h[1].length - 1, 2), 4);
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
    } else if (lines.every((l) => /^\s*[-•]\s+/.test(l) || /^\s{2,}\S/.test(l))) {
      const items = [];
      for (const l of lines) {
        if (/^\s*[-•]\s+/.test(l)) items.push(l.replace(/^\s*[-•]\s+/, ''));
        else items[items.length - 1] += ' ' + l.trim();
      }
      out.push(`<ul>${items.map((i) => `<li>${inline(i)}</li>`).join('')}</ul>`);
    } else if (lines.every((l) => /^\s*\d+\.\s+/.test(l) || /^\s{2,}\S/.test(l))) {
      const items = [];
      for (const l of lines) {
        if (/^\s*\d+\.\s+/.test(l)) items.push(l.replace(/^\s*\d+\.\s+/, ''));
        else items[items.length - 1] += ' ' + l.trim();
      }
      out.push(`<ol>${items.map((i) => `<li>${inline(i)}</li>`).join('')}</ol>`);
    } else {
      out.push(`<p>${lines.map(inline).join('<br>')}</p>`);
    }
  }
  return out.join('\n');
}
