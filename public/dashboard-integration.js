// ═══════════════════════════════════════════════════════════════
// HostPilot Dashboard Integration (Auth-Protected)
// ═══════════════════════════════════════════════════════════════
// Idagdag ito sa GHL Dashboard page mo, sa Custom JS section,
// O i-paste sa loob ng existing <script> tag ng dashboard HTML mo.
// ═══════════════════════════════════════════════════════════════

(function () {
  'use strict';

  // ─── CONFIG ──────────────────────────────────────────────────
  const API_BASE = 'https://YOUR-APP.onrender.com';  // Render URL mo
  const LOGIN_URL = '/login';                         // GHL login page mo

  // ─── AUTH MANAGER ────────────────────────────────────────────
  const auth = {
    getToken() { return sessionStorage.getItem('hp_access_token'); },
    getUser()  {
      try { return JSON.parse(sessionStorage.getItem('hp_user') || 'null'); }
      catch { return null; }
    },
    setToken(t) { sessionStorage.setItem('hp_access_token', t); },
    clear() {
      sessionStorage.removeItem('hp_access_token');
      sessionStorage.removeItem('hp_user');
    },
    redirect() { window.location.href = LOGIN_URL; },
  };

  // ─── FETCH WITH AUTO-REFRESH ─────────────────────────────────
  async function authFetch(path, options = {}) {
    const token = auth.getToken();
    if (!token) { auth.redirect(); return null; }

    const opts = {
      ...options,
      headers: {
        ...(options.headers || {}),
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      credentials: 'include',
    };

    let res = await fetch(API_BASE + path, opts);

    // Token expired? Try to refresh.
    if (res.status === 401) {
      const data = await res.clone().json().catch(() => ({}));
      if (data.code === 'TOKEN_EXPIRED') {
        const refreshed = await tryRefresh();
        if (refreshed) {
          opts.headers.Authorization = 'Bearer ' + auth.getToken();
          res = await fetch(API_BASE + path, opts);
        } else {
          auth.clear();
          auth.redirect();
          return null;
        }
      } else {
        auth.clear();
        auth.redirect();
        return null;
      }
    }

    return res;
  }

  async function tryRefresh() {
    try {
      const res = await fetch(API_BASE + '/auth/refresh', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) return false;
      const data = await res.json();
      auth.setToken(data.accessToken);
      return true;
    } catch {
      return false;
    }
  }

  // ─── HELPERS ─────────────────────────────────────────────────
  const fmtMoney = n => '$' + Number(n || 0).toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });

  const fmtDate = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return `${days[d.getDay()]} ${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}.${d.getFullYear()}`;
  };

  const timeAgo = iso => {
    if (!iso) return '';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60)    return Math.floor(diff) + 's ago';
    if (diff < 3600)  return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  };

  const escapeHtml = s => String(s || '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  const CHANNEL_COLORS = {
    'Airbnb':         '#FF5A5F',
    'Booking.com':    '#003580',
    'VRBO':           '#1555C0',
    'Agoda':          '#E0471F',
    'Direct':         '#56c299',
    'Direct booking': '#56c299',
    'Facebook':       '#1877F2',
    'WhatsApp':       '#25D366',
  };

  // ─── RENDERERS ───────────────────────────────────────────────

  function renderStats(data) {
    const stats = data.stats;
    const boxes = document.querySelectorAll('.db-grid-4 .stat-box');

    if (boxes[0]) {
      boxes[0].querySelector('.stat-val').textContent = fmtMoney(stats.revenue);
      boxes[0].querySelector('.stat-sub').textContent = `${stats.nights} Nights total`;
    }
    if (boxes[1]) {
      boxes[1].querySelector('.stat-val').textContent = stats.bookings;
      boxes[1].querySelector('.stat-sub').textContent = `${stats.nights} Nights total`;
    }
    if (boxes[2]) {
      boxes[2].querySelector('.stat-val').textContent = stats.cancellations;
    }

    const occBox = document.querySelectorAll('.db-grid-4 > .db-card')[3];
    if (occBox) {
      const text = occBox.querySelector('text');
      if (text) text.textContent = stats.occupancy + '%';
      const arc = occBox.querySelector('path[stroke="#1555C0"]');
      if (arc) {
        const angle = (stats.occupancy / 100) * 180;
        const rad = (angle - 180) * Math.PI / 180;
        const x = 55 + 45 * Math.cos(rad);
        const y = 60 + 45 * Math.sin(rad);
        const largeArc = angle > 180 ? 1 : 0;
        arc.setAttribute('d', `M 10 60 A 45 45 0 ${largeArc} 1 ${x.toFixed(2)} ${y.toFixed(2)}`);
      }
    }
  }

  function renderCalendar(data) {
    const tbody = document.querySelector('.cal-table tbody');
    if (!tbody) return;

    const properties = data.properties || [];
    const bookings   = data.bookings || [];

    const headers = document.querySelectorAll('.cal-table thead th:not(.cal-prop-col)');
    const dateRange = [];
    const today = new Date();
    for (let i = 0; i < headers.length; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - 4 + i);
      dateRange.push(d);
    }

    if (!properties.length) {
      tbody.innerHTML = '<tr><td colspan="12" style="padding:30px;text-align:center;color:#9ab8a9;">No properties yet — connect your Smoobu account or add properties in the admin panel.</td></tr>';
      return;
    }

    const rows = properties.slice(0, 9).map(prop => {
      let cells = `<td class="cal-prop-col">${escapeHtml(prop.name)}</td>`;
      const propBookings = bookings.filter(b =>
        b.apartment?.id === prop.id && b.type !== 'cancellation'
      );
      const used = new Set();

      dateRange.forEach((day, idx) => {
        if (used.has(idx)) { cells += '<td></td>'; return; }
        const dayStr = day.toISOString().slice(0, 10);
        const booking = propBookings.find(b => b.arrival === dayStr);

        if (booking) {
          const end = new Date(booking.departure);
          const span = Math.max(1, Math.round((end - day) / (1000*60*60*24)));
          const cappedSpan = Math.min(span, dateRange.length - idx);
          for (let s = 1; s < cappedSpan; s++) used.add(idx + s);

          const channel = booking.channel?.name || 'Direct';
          const color = CHANNEL_COLORS[channel] || '#56c299';
          const guests = (booking.adults || 0) + (booking.children || 0);

          cells += `<td style="position:relative;">
            <div class="cal-pill cal-pill-green" style="width:calc(${cappedSpan*100-10}% + ${cappedSpan*4}px);">
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

    tbody.innerHTML = rows;
  }

  function renderActivityFeed(data) {
    const feed = document.querySelector('.feed-list');
    if (!feed) return;

    const recent = (data.bookings || [])
      .filter(b => b.type !== 'cancellation')
      .sort((a, b) => new Date(b['created-at']) - new Date(a['created-at']))
      .slice(0, 3);

    if (!recent.length) {
      feed.innerHTML = '<div style="padding:30px;text-align:center;color:#9ab8a9;font-size:.85rem;">No recent bookings yet.</div>';
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

  function renderPlatformBreakdown(data) {
    const channels = data.byChannel || {};
    const totalRev = Object.values(channels).reduce((a, c) => a + c.revenue, 0);
    const totalBk  = Object.values(channels).reduce((a, c) => a + c.bookings, 0);
    const totalNt  = Object.values(channels).reduce((a, c) => a + c.nights, 0);
    const cols = document.querySelectorAll('.donut-col');
    if (!cols.length || totalRev === 0) return;

    const buildLegend = (metric, total) =>
      Object.entries(channels).map(([name, v]) => {
        const pct = total ? Math.round((v[metric] / total) * 100) : 0;
        const color = CHANNEL_COLORS[name] || '#56c299';
        return `<div><span class="donut-legend-dot" style="background:${color};"></span>${name} ${pct}%</div>`;
      }).join('');

    const buildConic = (metric, total) => {
      let cum = 0;
      const stops = Object.entries(channels).map(([name, v]) => {
        const pct = total ? (v[metric] / total) * 100 : 0;
        const color = CHANNEL_COLORS[name] || '#56c299';
        const s = `${color} ${cum}% ${cum + pct}%`;
        cum += pct;
        return s;
      });
      return `conic-gradient(${stops.join(', ')})`;
    };

    cols[0].querySelector('.donut-legend').innerHTML = buildLegend('revenue', totalRev);
    cols[0].querySelector('.donut').style.background = buildConic('revenue', totalRev);
    cols[1].querySelector('.donut-legend').innerHTML = buildLegend('bookings', totalBk);
    cols[1].querySelector('.donut').style.background = buildConic('bookings', totalBk);
    cols[2].querySelector('.donut-legend').innerHTML = buildLegend('nights', totalNt);
    cols[2].querySelector('.donut').style.background = buildConic('nights', totalNt);
  }

  function setBanner(text, color, isHtml = false) {
    const bar = document.querySelector('.db-demo-bar');
    if (!bar) return;
    bar.innerHTML = isHtml ? text : escapeHtml(text);
    if (color === 'live')    { bar.style.background = '#d4f0e4'; bar.style.color = '#1e8760'; }
    if (color === 'loading') { bar.style.background = '#fff8e1'; bar.style.color = '#7a6a00'; }
    if (color === 'error')   { bar.style.background = '#fff0ee'; bar.style.color = '#c13515'; }
  }

  // ─── HEADER UPDATE (show user name + logout) ─────────────────
  function setupHeader() {
    const user = auth.getUser();
    if (!user) return;

    // Update dashboard title
    const h = document.getElementById('demo-owner-name');
    if (h) h.textContent = `${user.firstName}'s Dashboard`;

    // Add logout button to nav
    const nav = document.querySelector('.db-nav-inner');
    if (nav && !document.getElementById('hp-logout-btn')) {
      const logoutBtn = document.createElement('button');
      logoutBtn.id = 'hp-logout-btn';
      logoutBtn.style.cssText = 'background:none;border:none;font-family:DM Sans,sans-serif;font-size:.9rem;font-weight:600;color:#c13515;cursor:pointer;display:flex;align-items:center;gap:6px;margin-left:12px;';
      logoutBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> Sign out';
      logoutBtn.onclick = async () => {
        try {
          await fetch(API_BASE + '/auth/logout', {
            method: 'POST', credentials: 'include',
          });
        } catch {}
        auth.clear();
        auth.redirect();
      };
      // remove the existing back button, add logout
      const backBtn = document.getElementById('hp-btn-back-main');
      if (backBtn) backBtn.replaceWith(logoutBtn);
      else nav.appendChild(logoutBtn);
    }
  }

  // ─── MAIN LOAD ───────────────────────────────────────────────
  async function loadDashboard() {
    setBanner('⏳ Loading your dashboard...', 'loading');
    setupHeader();

    const res = await authFetch('/api/dashboard');
    if (!res) return; // redirected to login

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setBanner('⚠️ Could not load: ' + (err.error || 'unknown error'), 'error');
      return;
    }

    const data = await res.json();
    setBanner('<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#26a676;margin-right:8px;"></span>Live data — connected to Smoobu', 'live');

    renderStats(data);
    renderCalendar(data);
    renderActivityFeed(data);
    renderPlatformBreakdown(data);
  }

  // ─── BOOT ────────────────────────────────────────────────────
  function init() {
    // Check auth on load
    if (!auth.getToken()) {
      auth.redirect();
      return;
    }

    // If dashboard is hidden behind a setup flow (your existing modal),
    // wait for it to be shown. Otherwise load immediately.
    const dp = document.getElementById('hp-demo-page');
    if (dp) {
      let loaded = false;
      const tryLoad = () => {
        if (loaded || !dp.classList.contains('show-dashboard')) return;
        loaded = true;
        loadDashboard();
      };
      new MutationObserver(tryLoad).observe(dp, {
        attributes: true, attributeFilter: ['class']
      });
      tryLoad();
      // If not shown yet, force show it (since user is logged in)
      if (!dp.classList.contains('show-dashboard')) {
        dp.classList.add('show-dashboard');
        document.documentElement.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
      }
    } else {
      loadDashboard();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();