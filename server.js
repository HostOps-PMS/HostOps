// ===================================================================
// HostPilot × Smoobu Proxy Server
// Deploy this to Render.com (free tier)
// ===================================================================
//
// Bakit kailangan: Sabi ng Smoobu docs, "API cannot be directly 
// called from your website/front-end application." Kaya kailangan ng
// proxy na may API key (server-side only, hindi makikita ng users).
// ===================================================================

const express = require('express');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── CONFIG ─────────────────────────────────────────────────────────
const SMOOBU_API_KEY = process.env.SMOOBU_API_KEY;   // set sa Render env vars
const SMOOBU_BASE    = 'https://login.smoobu.com/api';

// Limit which sites can hit your proxy. Add your real domain dito.
const ALLOWED_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5500',
  'https://hostpilot.onrender.com',     // palitan kapag may production URL ka
  // 'https://yourdomain.com',
];

app.use(cors({
  origin: function (origin, cb) {
    // allow tools like curl/Postman (no origin) at allowed origins lang
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS: ' + origin));
  }
}));

app.use(express.json());

// ── SIMPLE IN-MEMORY CACHE (60 seconds) ────────────────────────────
// Bawasan ang Smoobu API calls. 1000/min ang limit nila — sobrang luwag
// pero best practice na mag-cache.
const cache = new Map();
function getCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) { cache.delete(key); return null; }
  return hit.data;
}
function setCache(key, data, ttlMs = 60000) {
  cache.set(key, { data, expires: Date.now() + ttlMs });
}

// ── HELPER: call Smoobu with API key ───────────────────────────────
async function smoobuFetch(path) {
  const cacheKey = path;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const res = await fetch(SMOOBU_BASE + path, {
    headers: {
      'Api-Key': SMOOBU_API_KEY,
      'Cache-Control': 'no-cache'
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Smoobu ${res.status}: ${text}`);
  }
  const data = await res.json();
  setCache(cacheKey, data);
  return data;
}

// ── HEALTH CHECK ───────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'HostPilot × Smoobu Proxy' });
});

// ── ENDPOINT 1: Get all apartments/properties ──────────────────────
// GET /api/properties
app.get('/api/properties', async (req, res) => {
  try {
    const data = await smoobuFetch('/apartments');
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── ENDPOINT 2: Get bookings (with filters) ────────────────────────
// GET /api/bookings?from=2026-04-01&to=2026-04-30&apartmentId=123
app.get('/api/bookings', async (req, res) => {
  try {
    const params = new URLSearchParams();
    if (req.query.from)        params.append('from', req.query.from);
    if (req.query.to)          params.append('to', req.query.to);
    if (req.query.apartmentId) params.append('apartmentId', req.query.apartmentId);
    if (req.query.page)        params.append('page', req.query.page);
    if (req.query.pageSize)    params.append('pageSize', req.query.pageSize || '100');
    if (req.query.showCancellation) params.append('showCancellation', req.query.showCancellation);

    const path = '/reservations' + (params.toString() ? '?' + params : '');
    const data = await smoobuFetch(path);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── ENDPOINT 3: Get rates / availability ───────────────────────────
// GET /api/rates?apartmentIds=1,2,3&start=2026-04-01&end=2026-04-30
app.get('/api/rates', async (req, res) => {
  try {
    const { apartmentIds, start, end } = req.query;
    if (!apartmentIds || !start || !end) {
      return res.status(400).json({ error: 'apartmentIds, start, end required' });
    }
    const ids = apartmentIds.split(',').map(s => `apartments[]=${s.trim()}`).join('&');
    const path = `/rates?${ids}&start_date=${start}&end_date=${end}`;
    const data = await smoobuFetch(path);
    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── ENDPOINT 4: Aggregated dashboard stats ─────────────────────────
// GET /api/dashboard?from=2026-04-01&to=2026-04-30
// Eto yung "convenience endpoint" — tinatambak na lahat ng kailangan
// ng dashboard mo sa isang call para mas mabilis.
app.get('/api/dashboard', async (req, res) => {
  try {
    const today = new Date();
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastOfMonth  = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    const fmt = d => d.toISOString().slice(0, 10);
    const from = req.query.from || fmt(firstOfMonth);
    const to   = req.query.to   || fmt(lastOfMonth);

    // Parallel fetch para mabilis
    const [apartments, bookings] = await Promise.all([
      smoobuFetch('/apartments'),
      smoobuFetch(`/reservations?from=${from}&to=${to}&pageSize=100&excludeBlocked=true`)
    ]);

    const list = bookings.bookings || [];

    // ─ Compute totals ─
    let totalRevenue = 0;
    let totalNights  = 0;
    let cancellations = 0;
    const byChannel = {};

    list.forEach(b => {
      const nights = Math.max(1, Math.round(
        (new Date(b.departure) - new Date(b.arrival)) / (1000 * 60 * 60 * 24)
      ));

      if (b.type === 'cancellation') {
        cancellations++;
        return;
      }

      totalRevenue += Number(b.price) || 0;
      totalNights  += nights;

      const ch = b.channel?.name || 'Direct';
      byChannel[ch] = byChannel[ch] || { revenue: 0, bookings: 0, nights: 0 };
      byChannel[ch].revenue  += Number(b.price) || 0;
      byChannel[ch].bookings += 1;
      byChannel[ch].nights   += nights;
    });

    // Occupancy rate
    const daysInRange = Math.max(1, Math.round(
      (new Date(to) - new Date(from)) / (1000 * 60 * 60 * 24)
    ));
    const propsCount = (apartments.apartments || []).length || 1;
    const totalAvailableNights = daysInRange * propsCount;
    const occupancyPct = Math.min(100, Math.round((totalNights / totalAvailableNights) * 100));

    res.json({
      period: { from, to },
      stats: {
        revenue: totalRevenue,
        bookings: list.filter(b => b.type !== 'cancellation').length,
        cancellations,
        nights: totalNights,
        occupancy: occupancyPct
      },
      byChannel,
      properties: apartments.apartments || [],
      bookings: list
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── START ──────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`HostPilot × Smoobu proxy running on port ${PORT}`);
  if (!SMOOBU_API_KEY) {
    console.warn('⚠️  SMOOBU_API_KEY env variable not set!');
  }
});