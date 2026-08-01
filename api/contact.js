// api/contact.js
// Kontaktformular-Handler für prostatakrebs.online
// Nach PAN21-Netzwerk-Standard: Resend, Honeypot, Dwell-Time, gestuftes isGibberish, BLOCKED_EMAILS, Rate-Limit

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const CONTACT_FROM = process.env.CONTACT_FROM || 'noreply@pan21.com';
const CONTACT_TO = process.env.CONTACT_TO || 'kontakt@prostatakrebs.online';

// --- Netzwerkweite Spam-Blockliste (normalisierte Adressen) ---
const BLOCKED_EMAILS = new Set([
  'zazacukeq266@gmail.com',
  'edipajulodev85@gmail.com',
  'atanaxawum896@gmail.com',
]);

function normalizeEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  const [local, domain] = e.split('@');
  if (!domain) return e;
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    const noDots = local.replace(/\./g, '');
    const noPlus = noDots.split('+')[0];
    return `${noPlus}@gmail.com`;
  }
  return e;
}

// --- Gestuftes isGibberish (Juli 2026 Netzwerk-Standard) ---
function isGibberish(str) {
  const trimmed = (str || '').trim();

  // Eine komplette Nachricht, die aus einem einzigen zusammenhängenden Token
  // mit gemischter Groß-/Kleinschreibung besteht (keine Leerzeichen, keine
  // Satzzeichen), ist praktisch nie eine echte menschliche Nachricht — auch
  // wenn der Vokalanteil zufällig hoch genug ist, um die Ratio-Prüfung unten
  // zu unterlaufen (z.B. durch zufällig viele "y"s).
  if (/^[a-zA-ZäöüÄÖÜß]{10,40}$/.test(trimmed) && /[a-zäöüß]/.test(trimmed) && /[A-ZÄÖÜ]/.test(trimmed)) {
    return true;
  }

  const words = (str || '').split(/\s+/).filter(w => w.length >= 6);
  const vowelChars = 'aeiouyAEIOUYäöüÄÖÜàáâãåèéêëìíîïòóôõùúûýÀÁÂÃÅÈÉÊËÌÍÎÏÒÓÔÕÙÚÛÝ';
  for (const word of words) {
    const letters = word.replace(/[^a-zA-ZäöüÄÖÜßàáâãåèéêëìíîïòóôõùúûýÀÁÂÃÅÈÉÊËÌÍÎÏÒÓÔÕÙÚÛÝ]/g, '');
    if (letters.length < 6) continue;
    let vowels = 0;
    for (const ch of letters) if (vowelChars.includes(ch)) vowels++;
    const vowelRatio = vowels / letters.length;
    let transitions = 0;
    for (let i = 1; i < letters.length; i++) {
      const prevUpper = letters[i - 1] === letters[i - 1].toUpperCase() && letters[i - 1] !== letters[i - 1].toLowerCase();
      const curUpper = letters[i] === letters[i].toUpperCase() && letters[i] !== letters[i].toLowerCase();
      if (prevUpper !== curUpper) transitions++;
    }
    const transitionRatio = transitions / (letters.length - 1);
    const vowelThreshold = letters.length >= 14 ? 0.28 : (letters.length >= 11 ? 0.22 : 0.16);
    if (vowelRatio < vowelThreshold && transitionRatio > 0.3) return true;
  }
  if (/\S{61,}/.test(str || '')) return true;
  return false;
}

// looksHuman-Fallback: reiner No-Space-String über 60 Zeichen ist verdächtig
function looksHuman(str) {
  const s = String(str || '');
  const noSpace = s.replace(/\s+/g, '');
  if (noSpace.length > 60 && noSpace.length === s.replace(/^\s+|\s+$/g, '').length) {
    return false;
  }
  return true;
}

// --- simple In-Memory Rate-Limit (best effort, pro Lambda-Instanz) ---
const rateMap = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const windowMs = 10 * 60 * 1000; // 10 Minuten
  const limit = 5;
  const entry = rateMap.get(ip) || [];
  const recent = entry.filter((t) => now - t < windowMs);
  recent.push(now);
  rateMap.set(ip, recent);
  return recent.length > limit;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method_not_allowed' });
    return;
  }

  try {
    const body = typeof req.body === 'object' && req.body !== null ? req.body : JSON.parse(req.body || '{}');
    const { name, email, message, website, ts } = body;

    const ip =
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
      req.socket?.remoteAddress ||
      'unknown';

    if (isRateLimited(ip)) {
      res.status(429).json({ ok: false, error: 'rate_limited' });
      return;
    }

    // Honeypot
    if (website && String(website).trim() !== '') {
      res.status(200).json({ ok: true }); // Bot bekommt Erfolg vorgetäuscht
      return;
    }

    // Dwell-Time: Formular muss mindestens 3s offen gewesen sein
    const elapsed = Date.now() - Number(ts || 0);
    if (!ts || isNaN(elapsed) || elapsed < 3000) {
      res.status(200).json({ ok: true }); // Bot bekommt Erfolg vorgetäuscht
      return;
    }

    if (!email || !message || !name) {
      res.status(400).json({ ok: false, error: 'missing_fields' });
      return;
    }

    const emailStr = String(email).trim();
    const normalized = normalizeEmail(emailStr);
    if (BLOCKED_EMAILS.has(normalized)) {
      res.status(200).json({ ok: true }); // Bot bekommt Erfolg vorgetäuscht
      return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(emailStr)) {
      res.status(400).json({ ok: false, error: 'invalid_email' });
      return;
    }

    if (isGibberish(name) || isGibberish(message) || !looksHuman(message) || !looksHuman(name)) {
      res.status(200).json({ ok: true }); // Bot bekommt Erfolg vorgetäuscht
      return;
    }

    if (String(message).length > 5000 || String(name).length > 200) {
      res.status(400).json({ ok: false, error: 'too_long' });
      return;
    }

    if (!RESEND_API_KEY) {
      console.error('RESEND_API_KEY fehlt');
      res.status(500).json({ ok: false, error: 'server_config' });
      return;
    }

    const escapeHtml = (s) =>
      String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const html = `
      <div style="font-family:sans-serif;line-height:1.5;color:#22302a;">
        <p><strong>Neue Nachricht über prostatakrebs.online</strong></p>
        <p><strong>Name:</strong> ${escapeHtml(name)}<br>
        <strong>E-Mail:</strong> ${escapeHtml(emailStr)}<br>
        <strong>IP:</strong> ${escapeHtml(ip)}</p>
        <p><strong>Nachricht:</strong></p>
        <p style="white-space:pre-wrap;">${escapeHtml(message)}</p>
      </div>`;

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: `prostatakrebs.online <${CONTACT_FROM}>`,
        to: [CONTACT_TO],
        reply_to: emailStr,
        subject: `Kontaktanfrage von ${name}`,
        html,
      }),
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      console.error('Resend error:', errText);
      res.status(502).json({ ok: false, error: 'send_failed' });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Kontaktformular-Fehler:', err);
    res.status(500).json({ ok: false, error: 'server_error' });
  }
};
