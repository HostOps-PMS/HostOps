// ===================================================================
// HostPilot Dashboard × Smoobu Integration
// ===================================================================
// Ilagay mo lang `<script src="smoobu-integration.js"></script>` sa
// dashboard HTML mo, BAGO mag-close yung </body> tag.
//
// O kaya, i-paste mo na lang yung laman nito sa loob ng existing
// <script> tag mo, sa dulo, bago yung "})();" (yung huling line).
// ===================================================================

(function () {
  'use strict';

  // ─── CONFIG ──────────────────────────────────────────────────────
  // Palitan mo ito ng URL ng deployed proxy mo sa Render
  const PROXY_BASE = 'https://hostpilot-smoobu.onrender.com';
  // Para sa local testing: 'http://localhost:3000'

  // ─── HELPERS ─────────────────────────────────────────────────────
  const $  = sel => document.querySelector(sel);
  const $$ = sel => document.querySelectorAll(sel);

  function fmtMoney(n, currency = '$') {
    return currency + Number(n || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2, maximumFractionDigits: 2
    });
  }

  function fmtDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${days[d.getDay()]} ${dd}.${mm}.${d.getFullYear()}`;
  }

  function timeAgo(iso) {
    if (!iso) return '';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60)        return Math.floor(diff) + 's ago';
    if (diff < 3600)      return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400)     return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  // Map channel name → brand color
  const CHANNEL_COLORS = {
    'Airbnb':      '#FF5A5F',
    'Booking.com': '#003580',
    'VRBO':        '#1555C0',
    'Agoda':       '#E0471F',
    'Direct':      '#56c299',
    'Direct booking': '#56c299',
    'Facebook':    '#1877F2',
    'WhatsApp':    '#25D366'
  };

  // ─── DATA FETCHER ────────────────────────────────────────────────
  async function loadDashboard() {
    try {
      const res = await fetch(`${PROXY_BASE}/api/dashboard`);
      if (!res.ok) throw new Error('Proxy returned ' + res.status);
      const data = await res.json();
      console.log('Smoobu dashboard data:', data);
      return data;
    } catch (err) {
      console.error('Failed to load dashboard:', err);
      showError(err.message);
      return null;
    }
  }

  function showError(msg) {
    const banner = document.querySelector('.db-demo-bar');
    if (banner) {
      banner.innerHTML = `⚠️ Could not load live data — showing sample. (${msg})`;
      banner.style.background = '#fff0ee';
      banner.style.color = '#c13515';
    }
  }

  // ─── RENDER: STAT CARDS ──────────────────────────────────────────
  function renderStats(data) {
    const stats = data.stats;

    // Revenue card
    const revBox = document.querySelectorAll('.db-grid-4 .stat-box')[0];
    if (revBox) {
      revBox.querySelector('.stat-val').textContent = fmtMoney(stats.revenue);
      revBox.querySelector('.stat-sub').textContent = `${stats.nights} Nights total`;
    }

    // Bookings card
    const bkBox = document.querySelectorAll('.db-grid-4 .stat-box')[1];
    if (bkBox) {
      bkBox.querySelector('.stat-val').textContent = stats.bookings;
      bkBox.querySelector('.stat-sub').textContent = `${stats.nights} Nights total`;
    }

    // Cancellations card
    const cxBox = document.querySelectorAll('.db-grid-4 .stat-box')[2];
    if (cxBox) {
      cxBox.querySelector('.stat-val').textContent = stats.cancellations;
    }

    // Occupancy gauge
    const occBox = document.querySelectorAll('.db-grid-4 > .db-card')[3];
    if (occBox) {
      const text = occBox.querySelector('text');
      if (text) text.textContent = stats.occupancy + '%';
      // update arc length
      const arc = occBox.querySelector('path[stroke="#1555C0"]');
      if (arc) {
        const angle = (stats.occupancy / 100) * 180;
        const rad   = (angle - 180) * Math.PI / 180;
        const x = 55 + 45 * Math.cos(rad);
        const y = 60 + 45 * Math.sin(rad);
        const largeArc = angle > 180 ? 1 : 0;
        arc.setAttribute('d', `M 10 60 A 45 45 0 ${largeArc} 1 ${x.toFixed(2)} ${y.toFixed(2)}`);
      }
    }
  }

  // ─── RENDER: CALENDAR ────────────────────────────────────────────
  function renderCalendar(data) {
    const tbody = document.querySelector('.cal-table tbody');
    if (!tbody) return;

    const properties = data.properties || [];
    const bookings   = data.bookings   || [];

    // Get the date range shown in the calendar header
    const headers = document.querySelectorAll('.cal-table thead th:not(.cal-prop-col)');
    const dateRange = []; // array of Date objects
    const today = new Date();
    const startDay = today.getDate();
    for (let i = 0; i < headers.length; i++) {
      const d = new Date(today);
      d.setDate(startDay - 4 + i); // start 4 days back, like sample
      dateRange.push(d);
    }

    // Build new rows
    const rows = properties.slice(0, 9).map(prop => {
      let cells = `<td class="cal-prop-col">${escapeHtml(prop.name)}</td>`;
      const propBookings = bookings.filter(b =>
        b.apartment && b.apartment.id === prop.id && b.type !== 'cancellation'
      );

      // Track which dates already have a pill
      const used = new Set();

      dateRange.forEach((day, idx) => {
        if (used.has(idx)) {
          cells += '<td></td>';
          return;
        }
        // Find a booking that starts on this day
        const dayStr = day.toISOString().slice(0, 10);
        const booking = propBookings.find(b => b.arrival === dayStr);

        if (booking) {
          const end = new Date(booking.departure);
          const span = Math.max(1, Math.round((end - day) / (1000*60*60*24)));
          const cappedSpan = Math.min(span, dateRange.length - idx);
          for (let s = 1; s < cappedSpan; s++) used.add(idx + s);

          const channel = booking.channel?.name || 'Direct';
          const color   = CHANNEL_COLORS[channel] || '#56c299';
          const pillClass = booking.type === 'cancellation' ? 'cal-pill-red' : 'cal-pill-green';
          const guests = (booking.adults || 0) + (booking.children || 0);

          cells += `<td style="position:relative;">
            <div class="cal-pill ${pillClass}" style="width:calc(${cappedSpan * 100 - 10}% + ${cappedSpan * 4}px);">
              <span class="cal-pill-ic" style="background:${color};"></span>
              ${escapeHtml(booking['guest-name'] || 'Guest')} · ${guests || 1} guests · ${fmtMoney(booking.price)}
            </div>
          </td>`;
        } else {
          cells += '<td></td>';
        }
      });

      return `<tr>${cells}</tr>`;
    }).join('');

    tbody.innerHTML = rows || '<tr><td colspan="12" style="padding:30px;text-align:center;color:#9ab8a9;">No properties found</td></tr>';
  }

  // ─── RENDER: ACTIVITY FEED ───────────────────────────────────────
  function renderActivityFeed(data) {
    const feed = document.querySelector('.feed-list');
    if (!feed) return;

    const recent = (data.bookings || [])
      .filter(b => b.type !== 'cancellation')
      .sort((a, b) => new Date(b['created-at']) - new Date(a['created-at']))
      .slice(0, 3);

    if (!recent.length) {
      feed.innerHTML = '<div style="padding:30px;text-align:center;color:#9ab8a9;font-size:.85rem;">No recent bookings</div>';
      return;
    }

    feed.innerHTML = recent.map(b => {
      const channel = b.channel?.name || 'Direct';
      const initial = channel[0] || 'D';
      const color   = CHANNEL_COLORS[channel] || '#56c299';
      const nights  = Math.max(1, Math.round(
        (new Date(b.departure) - new Date(b.arrival)) / (1000*60*60*24)
      ));

      return `
        <div class="feed-item">
          <div class="feed-row">
            <div class="feed-left">
              <div class="feed-avatar" style="background:${color}22;color:${color};">${initial}</div>
              <span class="feed-badge">New booking</span>
            </div>
            <div class="feed-stats">
              <span class="feed-stat">${fmtMoney(b.price)}</span>
              <span class="feed-stat">${nights} night${nights > 1 ? 's' : ''}</span>
            </div>
          </div>
          <div class="feed-info">
            <div class="feed-guest">${escapeHtml(b['guest-name'] || 'Guest')}</div>
            <div class="feed-date">${fmtDate(b.arrival)}</div>
          </div>
          <div class="feed-prop">${escapeHtml(b.apartment?.name || '')}</div>
          <div class="feed-time">${timeAgo(b['created-at'])}</div>
        </div>
      `;
    }).join('');
  }

  // ─── RENDER: PLATFORM DONUTS ─────────────────────────────────────
  function renderPlatformBreakdown(data) {
    const channels = data.byChannel || {};
    const totalRev = Object.values(channels).reduce((a, c) => a + c.revenue, 0);
    const totalBk  = Object.values(channels).reduce((a, c) => a + c.bookings, 0);
    const totalNt  = Object.values(channels).reduce((a, c) => a + c.nights, 0);

    const cols = document.querySelectorAll('.donut-col');
    if (!cols.length || totalRev === 0) return;

    function buildLegend(metric, total) {
      return Object.entries(channels)
        .map(([name, v]) => {
          const pct = total ? Math.round((v[metric] / total) * 100) : 0;
          const color = CHANNEL_COLORS[name] || '#56c299';
          return `<div><span class="donut-legend-dot" style="background:${color};"></span>${name} ${pct}%</div>`;
        }).join('');
    }

    function buildConicGradient(metric, total) {
      let cumulative = 0;
      const stops = Object.entries(channels).map(([name, v]) => {
        const pct = total ? (v[metric] / total) * 100 : 0;
        const color = CHANNEL_COLORS[name] || '#56c299';
        const s = `${color} ${cumulative}% ${cumulative + pct}%`;
        cumulative += pct;
        return s;
      });
      return `conic-gradient(${stops.join(', ')})`;
    }

    cols[0].querySelector('.donut-legend').innerHTML = buildLegend('revenue', totalRev);
    cols[0].querySelector('.donut').style.background = buildConicGradient('revenue', totalRev);

    cols[1].querySelector('.donut-legend').innerHTML = buildLegend('bookings', totalBk);
    cols[1].querySelector('.donut').style.background = buildConicGradient('bookings', totalBk);

    cols[2].querySelector('.donut-legend').innerHTML = buildLegend('nights', totalNt);
    cols[2].querySelector('.donut').style.background = buildConicGradient('nights', totalNt);
  }

  // ─── UTILS ───────────────────────────────────────────────────────
  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, c =>
      ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ─── INIT: hook into existing dashboard show ─────────────────────
  // The dashboard becomes visible kapag may class na 'show-dashboard'
  // sa #hp-demo-page. Kaya we observe yan.
  function init() {
    const dp = document.getElementById('hp-demo-page');
    if (!dp) return;

    let loaded = false;
    const tryLoad = async () => {
      if (loaded || !dp.classList.contains('show-dashboard')) return;
      loaded = true;

      // Update demo bar to show loading
      const bar = document.querySelector('.db-demo-bar');
      if (bar) {
        bar.innerHTML = '⏳ Loading live data from Smoobu...';
        bar.style.background = '#fff8e1';
        bar.style.color = '#7a6a00';
      }

      const data = await loadDashboard();
      if (!data) return;

      // Update banner to "Live"
      if (bar) {
        bar.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#26a676;margin-right:8px;"></span>Live data — connected to Smoobu`;
        bar.style.background = '#d4f0e4';
        bar.style.color = '#1e8760';
      }

      renderStats(data);
      renderCalendar(data);
      renderActivityFeed(data);
      renderPlatformBreakdown(data);
    };

    // Watch for class change
    new MutationObserver(tryLoad).observe(dp, {
      attributes: true, attributeFilter: ['class']
    });

    // If already showing on load
    tryLoad();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();