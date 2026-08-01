// news-widget.js
// Rendert 3-4 Gesundheits-News-Kacheln mit Bild + Bildquelle am Seitenfuß (Feedzy-Prinzip)
(function () {
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function formatDate(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    } catch (e) {
      return '';
    }
  }

  function render(mount, items) {
    if (!items || !items.length) {
      mount.innerHTML =
        '<section class="health-news"><div class="hn-head"><h2>Aktuelle Gesundheits-News</h2></div>' +
        '<p class="hn-empty">Gerade keine aktuellen Meldungen verfügbar.</p></section>';
      return;
    }

    var cards = items
      .slice(0, 4)
      .map(function (item) {
        var imgHtml = item.image
          ? '<div class="hn-img-wrap"><img src="' + escapeHtml(item.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer"></div>'
          : '<div class="hn-img-wrap hn-noimg"><span>' + escapeHtml(item.source) + '</span></div>';

        return (
          '<a class="hn-card" href="' + escapeHtml(item.link) + '" target="_blank" rel="noopener noreferrer">' +
          imgHtml +
          '<div class="hn-body">' +
          '<span class="hn-source">' + escapeHtml(item.source) + (item.pubDate ? ' · ' + formatDate(item.pubDate) : '') + '</span>' +
          '<h3>' + escapeHtml(item.title) + '</h3>' +
          '<div class="hn-credit">Bild: ' + escapeHtml(item.credit || item.source) + '</div>' +
          '</div>' +
          '</a>'
        );
      })
      .join('');

    mount.innerHTML =
      '<section class="health-news">' +
      '<div class="hn-head"><h2>Aktuelle Gesundheits-News</h2>' +
      '<div class="hn-sub">Aktuelle Meldungen aus Medizin und Forschung, mit Bildquelle. Verlinkt auf die jeweilige Originalquelle.</div></div>' +
      '<div class="hn-grid">' + cards + '</div>' +
      '</section>';
  }

  function init() {
    var mount = document.getElementById('health-news-mount');
    if (!mount) return;
    fetch('/api/health-news')
      .then(function (r) { return r.json(); })
      .then(function (data) { render(mount, data.items); })
      .catch(function () { mount.innerHTML = ''; });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
