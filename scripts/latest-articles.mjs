// Baut den Block „Neueste Artikel“ auf der Startseite aus den vorhandenen Blogartikeln.
// Quelle: sitemap-blog.xml + <h1>/datePublished der Artikel unter blog/<slug>/index.html.
// Nutzung: node scripts/latest-articles.mjs html <root> <index.html>  (ersetzt zwischen den Markern)
//          node scripts/latest-articles.mjs json <root> <out.json>
import fs from 'node:fs';
import path from 'node:path';

const [mode = 'html', root = '.', target = 'index.html', limitArg = '6'] = process.argv.slice(2);
const LIMIT = Number(limitArg) || 6;
const START = '<!-- latest-articles:start -->';
const END = '<!-- latest-articles:end -->';

function collect() {
  const smPath = path.join(root, 'sitemap-blog.xml');
  if (!fs.existsSync(smPath)) return [];
  const xml = fs.readFileSync(smPath, 'utf8');
  const out = [];
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
    const loc = (m[1].match(/<loc>\s*([^<\s]+)\s*<\/loc>/) || [])[1];
    const lastmod = (m[1].match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/) || [])[1] || '';
    if (!loc) continue;
    let p;
    try { p = new URL(loc).pathname; } catch { continue; }
    const mm = p.match(/^\/blog\/([^/]+)\/?$/);
    if (!mm) continue;
    const file = path.join(root, 'blog', mm[1], 'index.html');
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, 'utf8');
    const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
    if (!h1) continue;
    const title = h1.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    if (!title) continue;
    const pub = (html.match(/"datePublished"\s*:\s*"([^"]+)"/) || [])[1] || lastmod;
    out.push({ href: `/blog/${mm[1]}/`, title, date: pub ? pub.slice(0, 10) : '' });
  }
  out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return out.slice(0, LIMIT);
}

const fmt = (d) => { const [y, m, t] = d.split('-'); return y && m && t ? `${t}.${m}.${y}` : ''; };
const items = collect();

if (mode === 'json') {
  fs.writeFileSync(target, JSON.stringify(items, null, 2) + '\n');
} else {
  const file = path.join(root, target);
  const src = fs.readFileSync(file, 'utf8');
  const a = src.indexOf(START), b = src.indexOf(END);
  if (a < 0 || b < a) { console.log('latest-articles: Marker fehlen, nichts geändert'); process.exit(0); }
  const list = items.map((i) =>
    `      <li class="na-item"><a class="na-link" href="${i.href}">${i.date ? `<time class="na-date" datetime="${i.date}">${fmt(i.date)}</time>` : ''}<span class="na-title">${i.title}</span></a></li>`
  ).join('\n');
  const block = `${START}\n    <ul class="na-list">\n${list}\n    </ul>\n    ${END}`;
  fs.writeFileSync(file, src.slice(0, a) + block + src.slice(b + END.length));
}
console.log(`latest-articles: ${items.length} Artikel`);
