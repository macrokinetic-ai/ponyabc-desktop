#!/usr/bin/env node
// Renders a manual Markdown file to a print-ready PDF with headless Chrome.
//
// No pandoc/wkhtmltopdf on this machine, and adding a toolchain for two documents would be a
// poor trade — Chrome is already here, prints to PDF properly, and handles CJK text and the
// screenshots without extra fonts.
//
// Usage: node scripts/manual-to-pdf.mjs docs/manual/Guide-en.md docs/manual/Guide-en.pdf
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const [mdPath, pdfPath] = process.argv.slice(2);
if (!mdPath || !pdfPath) {
  console.error('Usage: node scripts/manual-to-pdf.mjs <input.md> <output.pdf>');
  process.exit(2);
}

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const md = fs.readFileSync(mdPath, 'utf8');
const baseDir = path.resolve(path.dirname(mdPath));

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A deliberately small Markdown subset — exactly what the manuals use, nothing more. */
function render(source) {
  const out = [];
  let inTable = false;
  let inList = false;
  let listTag = 'ul';

  const inline = (t) =>
    esc(t)
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) => `<img src="${src}" alt="${alt}">`)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

  const closeList = () => {
    if (inList) { out.push(`</${listTag}>`); inList = false; }
  };
  const closeTable = () => {
    if (inTable) { out.push('</tbody></table>'); inTable = false; }
  };

  for (const raw of source.split('\n')) {
    const line = raw.trimEnd();

    // An indented line continues the list item above it. Without this a wrapped item — a long
    // URL on its own line, say — ended the list and the next item restarted the numbering at 1.
    if (inList && /^\s{2,}\S/.test(raw)) {
      out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, ` ${inline(line.trim())}</li>`);
      continue;
    }

    if (/^\|/.test(line)) {
      const cells = line.split('|').slice(1, -1).map((c) => c.trim());
      if (cells.every((c) => /^-+$/.test(c.replace(/:/g, '')))) continue; // separator row
      closeList();
      if (!inTable) {
        out.push('<table><thead><tr>' + cells.map((c) => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>');
        inTable = true;
      } else {
        out.push('<tr>' + cells.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>');
      }
      continue;
    }
    closeTable();

    if (/^#{1,4} /.test(line)) {
      closeList();
      const level = line.match(/^#+/)[0].length;
      out.push(`<h${level}>${inline(line.slice(level + 1))}</h${level}>`);
    } else if (/^[-*] /.test(line)) {
      if (!inList) { out.push('<ul>'); inList = true; listTag = 'ul'; }
      out.push(`<li>${inline(line.slice(2))}</li>`);
    } else if (/^\d+\. /.test(line)) {
      if (!inList) { out.push('<ol>'); inList = true; listTag = 'ol'; }
      out.push(`<li>${inline(line.replace(/^\d+\. /, ''))}</li>`);
    } else if (/^> /.test(line)) {
      closeList();
      out.push(`<blockquote>${inline(line.slice(2))}</blockquote>`);
    } else if (/^---+$/.test(line)) {
      closeList();
      out.push('<hr>');
    } else if (line === '') {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  closeTable();
  return out.join('\n');
}

const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(path.basename(mdPath))}</title>
<base href="file://${baseDir}/">
<style>
  @page { size: A4; margin: 18mm 16mm; }
  body { font: 11pt/1.55 "Helvetica Neue", Helvetica, Arial, "PingFang TC", "Heiti TC", sans-serif; color: #1c1917; }
  h1 { font-size: 22pt; margin: 0 0 4pt; }
  h2 { font-size: 15pt; margin: 20pt 0 4pt; page-break-after: avoid; }
  h3 { font-size: 12pt; margin: 14pt 0 3pt; page-break-after: avoid; }
  p, li { orphans: 3; widows: 3; }
  ul { padding-left: 18pt; }
  ol { padding-left: 18pt; }
  blockquote { margin: 8pt 0; padding: 7pt 10pt; background: #fdf6ec; border-left: 3px solid #e8623c; }
  blockquote p { margin: 0; }
  img { max-width: 100%; border: 1px solid #e7e5e4; border-radius: 4px; margin: 6pt 0; page-break-inside: avoid; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; page-break-inside: avoid; }
  th, td { border: 1px solid #e7e5e4; padding: 5pt 7pt; text-align: left; vertical-align: top; font-size: 10pt; }
  th { background: #faf7f2; }
  code { background: #f5f5f4; padding: 1pt 3pt; border-radius: 3px; font-size: 9.5pt; }
  hr { border: 0; border-top: 1px solid #e7e5e4; margin: 16pt 0; }
  a { color: #b4462a; text-decoration: none; }
</style></head><body>
${render(md)}
</body></html>`;

const tmpHtml = pdfPath.replace(/\.pdf$/, '.tmp.html');
fs.writeFileSync(tmpHtml, html, 'utf8');
try {
  execFileSync(CHROME, ['--headless', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${path.resolve(pdfPath)}`, `file://${path.resolve(tmpHtml)}`], {
    stdio: 'ignore',
    timeout: 120_000,
  });
} finally {
  fs.rmSync(tmpHtml, { force: true });
}
const size = fs.statSync(pdfPath).size;
console.log(`${pdfPath} — ${(size / 1024).toFixed(0)} KB`);
