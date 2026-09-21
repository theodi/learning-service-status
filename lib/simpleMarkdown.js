/**
 * Minimal Markdown → HTML for SPEC.md (no dependency).
 * Supports: ATX headings, fenced code, tables, lists, paragraphs, inline code/bold/links.
 */

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function inlineFormat(text) {
  let s = escapeHtml(text);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  return s;
}

function renderSimpleMarkdown(md) {
  const lines = String(md || '').split(/\r?\n/);
  const out = [];
  let i = 0;
  let inCode = false;
  let codeLang = '';
  let codeBuf = [];

  const flushCode = () => {
    out.push(
      `<pre class="md-code"><code class="language-${escapeHtml(codeLang)}">${escapeHtml(
        codeBuf.join('\n')
      )}</code></pre>`
    );
    codeBuf = [];
    codeLang = '';
    inCode = false;
  };

  while (i < lines.length) {
    const line = lines[i];

    if (line.startsWith('```')) {
      if (inCode) {
        flushCode();
      } else {
        inCode = true;
        codeLang = line.slice(3).trim();
      }
      i += 1;
      continue;
    }
    if (inCode) {
      codeBuf.push(line);
      i += 1;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inlineFormat(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    if (line.trim().startsWith('|') && i + 1 < lines.length && /^\|?\s*-+/.test(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        const cells = lines[i]
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim());
        rows.push(cells);
        i += 1;
        if (i < lines.length && /^\|?\s*-+/.test(lines[i])) {
          i += 1; // skip separator
        } else if (i < lines.length && !lines[i].trim().startsWith('|')) {
          break;
        }
      }
      if (rows.length) {
        const [header, ...body] = rows;
        out.push('<table class="md-table"><thead><tr>');
        header.forEach((c) => out.push(`<th>${inlineFormat(c)}</th>`));
        out.push('</tr></thead><tbody>');
        body.forEach((row) => {
          out.push('<tr>');
          row.forEach((c) => out.push(`<td>${inlineFormat(c)}</td>`));
          out.push('</tr>');
        });
        out.push('</tbody></table>');
      }
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      out.push('<ul>');
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) {
        out.push(`<li>${inlineFormat(lines[i].replace(/^[-*]\s+/, ''))}</li>`);
        i += 1;
      }
      out.push('</ul>');
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      out.push('<ol>');
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        out.push(`<li>${inlineFormat(lines[i].replace(/^\d+\.\s+/, ''))}</li>`);
        i += 1;
      }
      out.push('</ol>');
      continue;
    }

    if (!line.trim()) {
      i += 1;
      continue;
    }

    const para = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() &&
      !lines[i].startsWith('#') &&
      !lines[i].startsWith('```') &&
      !lines[i].trim().startsWith('|') &&
      !/^[-*]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    out.push(`<p>${inlineFormat(para.join(' '))}</p>`);
  }

  if (inCode) flushCode();
  return out.join('\n');
}

module.exports = { renderSimpleMarkdown, escapeHtml };
