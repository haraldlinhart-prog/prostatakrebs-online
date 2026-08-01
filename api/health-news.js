// api/health-news.js
// Aggregiert aktuelle Gesundheits-News aus mehreren RSS-Quellen inkl. Bild + Bildquelle
// (Feedzy-Prinzip: mehrere Feeds mischen, nach Datum sortieren, mit Bild anzeigen)

const SPEKTRUM_HEALTH_KEYWORDS = [
  'gesundheit', 'medizin', 'krebs', 'krankheit', 'therapie', 'diagnose',
  'herz', 'diabetes', 'impf', 'virus', 'klinik', 'patient', 'psyche',
  'ernährung', 'schlaf', 'gehirn', 'depression', 'risiko', 'tumor',
  'prostata', 'immun', 'studie'
];

let cache = { data: null, ts: 0 };
const CACHE_MS = 60 * 60 * 1000; // 1 Stunde

function stripCdata(s) {
  if (!s) return '';
  return s.replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
}

function extractTag(block, tag) {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? stripCdata(m[1]) : '';
}

function stripHtml(s) {
  return String(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

async function fetchWithTimeout(url, ms) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0 (compatible; prostatakrebs-online-newsbot/1.0)' } });
    clearTimeout(t);
    return res;
  } catch (e) {
    clearTimeout(t);
    return null;
  }
}

async function fetchOgImage(articleUrl) {
  try {
    const res = await fetchWithTimeout(articleUrl, 4000);
    if (!res || !res.ok) return null;
    const html = await res.text();
    const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
    return m ? m[1].replace(/&amp;/g, '&') : null;
  } catch (e) {
    return null;
  }
}

async function fetchAerzteblatt() {
  const res = await fetchWithTimeout('https://www.aerzteblatt.de/rss/news.asp', 5000);
  if (!res || !res.ok) return [];
  const xml = await res.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
  const parsed = items.slice(0, 12).map((block) => ({
    title: extractTag(block, 'title'),
    link: extractTag(block, 'link'),
    description: stripHtml(extractTag(block, 'description')).replace(/\[weiter lesen\]$/, '').trim(),
    pubDate: extractTag(block, 'pubDate'),
    source: 'Deutsches Ärzteblatt',
    sourceUrl: 'https://www.aerzteblatt.de/',
    image: null,
    credit: 'Deutsches Ärzteblatt',
  }));

  // og:image für die ersten Artikel nachladen (Feedzy-Stil: Bild von der Zielseite holen)
  await Promise.all(
    parsed.slice(0, 10).map(async (item) => {
      item.image = await fetchOgImage(item.link);
    })
  );

  return parsed;
}

async function fetchSpektrum() {
  const res = await fetchWithTimeout('https://www.spektrum.de/alias/rss/spektrum-de-rss-feed/996406', 5000);
  if (!res || !res.ok) return [];
  const xml = await res.text();
  const items = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

  return items
    .map((block) => {
      const title = extractTag(block, 'title');
      const description = stripHtml(extractTag(block, 'description'));
      const text = (title + ' ' + description).toLowerCase();
      const isHealth = SPEKTRUM_HEALTH_KEYWORDS.some((k) => text.includes(k));
      if (!isHealth) return null;

      const imgMatch = block.match(/<media:content[^>]+url=["']([^"']+)["']/i);
      const creditMatch = block.match(/<media:credit[^>]*>([\s\S]*?)<\/media:credit>/i);

      return {
        title,
        link: extractTag(block, 'link'),
        description,
        pubDate: extractTag(block, 'pubDate'),
        source: 'Spektrum.de',
        sourceUrl: 'https://www.spektrum.de/',
        image: imgMatch ? imgMatch[1] : null,
        credit: creditMatch ? stripCdata(creditMatch[1]).trim() : 'Spektrum.de',
      };
    })
    .filter(Boolean);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200');

  const now = Date.now();
  if (cache.data && now - cache.ts < CACHE_MS) {
    res.status(200).json(cache.data);
    return;
  }

  try {
    const [aerzte, spektrum] = await Promise.all([fetchAerzteblatt(), fetchSpektrum()]);
    let all = [...aerzte, ...spektrum]
      .filter((i) => i.title && i.link)
      .sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

    // Duplikate nach Titel entfernen
    const seen = new Set();
    all = all.filter((i) => {
      if (seen.has(i.title)) return false;
      seen.add(i.title);
      return true;
    });

    const result = { items: all.slice(0, 12), updatedAt: new Date().toISOString() };
    cache = { data: result, ts: now };
    res.status(200).json(result);
  } catch (err) {
    console.error('health-news error:', err);
    if (cache.data) {
      res.status(200).json(cache.data);
    } else {
      res.status(200).json({ items: [], updatedAt: new Date().toISOString() });
    }
  }
};
