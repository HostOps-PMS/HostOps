// src/services/smoobu.js
//
// Smoobu API wrapper with PAGINATION, proper cancellation counting,
// at flexible date range support.
//
// Single-Smoobu mode: lahat tumatawag using SMOOBU_API_KEY,
// pero ang results are filtered by user.propertyTagPrefix (or admin sees all).

const BASE = 'https://login.smoobu.com/api';
const cache = new Map();

function getCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) { cache.delete(key); return null; }
  return hit.data;
}

function setCache(key, data, ttlMs = 60_000) {
  cache.set(key, { data, expires: Date.now() + ttlMs });
}

async function smoobuRequest(path, apiKey) {
  const cacheKey = `${apiKey}:${path}`;
  const cached = getCache(cacheKey);
  if (cached) return cached;

  const res = await fetch(BASE + path, {
    headers: {
      'Api-Key': apiKey,
      'Cache-Control': 'no-cache',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`Smoobu ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }

  const data = await res.json();
  setCache(cacheKey, data);
  return data;
}

// ─────────────────────────────────────────────────────────────────
// PAGINATED FETCH — iterate through all pages until done
// Smoobu max page_size = 100. May "page_count" sa response.
// ─────────────────────────────────────────────────────────────────
async function smoobuRequestAllPages(basePath, apiKey, { showCancellation = true } = {}) {
  const allBookings = [];
  let page = 1;
  let totalPages = 1;
  const PAGE_SIZE = 100;

  do {
    const sep = basePath.includes('?') ? '&' : '?';
    const path = `${basePath}${sep}page=${page}&pageSize=${PAGE_SIZE}${showCancellation ? '&showCancellation=1' : ''}`;
    const data = await smoobuRequest(path, apiKey);

    if (data.bookings && Array.isArray(data.bookings)) {
      allBookings.push(...data.bookings);
    }

    totalPages = data.page_count || 1;
    page++;

    // Safety: max 50 pages (5000 bookings) para hindi infinite loop
    if (page > 50) {
      console.warn('Smoobu pagination exceeded 50 pages, stopping');
      break;
    }
  } while (page <= totalPages);

  return { bookings: allBookings, total: allBookings.length };
}

// ─────────────────────────────────────────────────────────────────
// USER FILTERING
// ─────────────────────────────────────────────────────────────────
export function getApiKeyForUser(user) {
  if (user.smoobuApiKey) return user.smoobuApiKey;
  return process.env.SMOOBU_API_KEY;
}

function belongsToUser(propertyName, user) {
  if (user.role === 'admin') return true;
  if (!user.propertyTagPrefix) return false;
  return propertyName?.toLowerCase().startsWith(
    user.propertyTagPrefix.toLowerCase()
  );
}

function displayName(name, user) {
  if (!user.propertyTagPrefix) return name;
  const prefix = user.propertyTagPrefix.toLowerCase();
  if (name?.toLowerCase().startsWith(prefix)) {
    return name.slice(prefix.length).trim().replace(/^[_-]\s*/, '');
  }
  return name;
}

// ─────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────

export async function getApartments(user) {
  const apiKey = getApiKeyForUser(user);
  const data = await smoobuRequest('/apartments', apiKey);
  const filtered = (data.apartments || [])
    .filter(a => belongsToUser(a.name, user))
    .map(a => ({ ...a, name: displayName(a.name, user) }));
  return { apartments: filtered };
}

export async function getBookings(user, { from, to, apartmentId, showCancellation = true } = {}) {
  const apiKey = getApiKeyForUser(user);

  // Get user's apartment IDs first (for filtering)
  const apartmentsData = await smoobuRequest('/apartments', apiKey);
  const userApartmentIds = new Set(
    (apartmentsData.apartments || [])
      .filter(a => belongsToUser(a.name, user))
      .map(a => a.id)
  );

  // Build base path with filters
  const params = new URLSearchParams();
  if (from) params.append('from', from);
  if (to)   params.append('to', to);
  if (apartmentId) params.append('apartmentId', apartmentId);
  // Note: hindi tayo nag-pa-pass ng excludeBlocked — gusto natin makuha lahat,
  // tapos manual natin i-filter sa frontend kung blocked vs reservation

  const basePath = `/reservations?${params.toString()}`;

  // ── PAGINATED FETCH ──
  const { bookings: allBookings } = await smoobuRequestAllPages(basePath, apiKey, { showCancellation });

  // Filter to user's properties + apply display name
  const bookings = allBookings
    .filter(b => userApartmentIds.has(b.apartment?.id))
    .map(b => ({
      ...b,
      apartment: {
        ...b.apartment,
        name: displayName(b.apartment.name, user),
      },
    }));

  return { bookings, total: bookings.length };
}

export async function getRates(user, { apartmentIds, start, end }) {
  const apiKey = getApiKeyForUser(user);

  const apartmentsData = await smoobuRequest('/apartments', apiKey);
  const userApartmentIds = new Set(
    (apartmentsData.apartments || [])
      .filter(a => belongsToUser(a.name, user))
      .map(a => String(a.id))
  );

  const ownedIds = apartmentIds.filter(id => userApartmentIds.has(String(id)));
  if (ownedIds.length === 0) {
    return { data: {} };
  }

  const idsParam = ownedIds.map(id => `apartments[]=${id}`).join('&');
  return smoobuRequest(
    `/rates?${idsParam}&start_date=${start}&end_date=${end}`,
    apiKey
  );
}

// ─────────────────────────────────────────────────────────────────
// MESSAGING — Get inbox (latest messages from recent reservations)
// ─────────────────────────────────────────────────────────────────

export async function getInbox(user, { limit = 5, daysBack = 60 } = {}) {
  const apiKey = getApiKeyForUser(user);

  // Get apartments owned by user (for filtering)
  const apartmentsData = await smoobuRequest('/apartments', apiKey);
  const userApartmentIds = new Set(
    (apartmentsData.apartments || [])
      .filter(a => belongsToUser(a.name, user))
      .map(a => a.id)
  );

  // Get recent bookings (last X days)
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - daysBack);
  const fmt = d => d.toISOString().slice(0, 10);

  const { bookings } = await smoobuRequestAllPages(
    `/reservations?from=${fmt(from)}&to=${fmt(today)}`,
    apiKey,
    { showCancellation: false }
  );

  // Filter user's bookings, sort by most recent
  const recent = bookings
    .filter(b => userApartmentIds.has(b.apartment?.id))
    .filter(b => !b['is-blocked-booking'] && b.type !== 'cancellation')
    .sort((a, b) => new Date(b['created-at']) - new Date(a['created-at']))
    .slice(0, limit * 2); // get extra para may buffer kung wala silang messages

  // Fetch messages for each reservation in parallel
  const threads = await Promise.allSettled(
    recent.map(async (b) => {
      try {
        const msgData = await smoobuRequest(`/reservations/${b.id}/messages`, apiKey);
        const messages = msgData.messages || msgData || [];
        const msgArr = Array.isArray(messages) ? messages : [];
        if (msgArr.length === 0) return null;

        const latest = msgArr[msgArr.length - 1];
        return {
          reservationId: b.id,
          guestName: b['guest-name'],
          property: displayName(b.apartment?.name, user),
          channel: b.channel?.name || 'Direct',
          latestMessage: {
            body: latest.message || latest.messageBody || latest.body || '',
            createdAt: latest['created-at'] || latest.createdAt || latest.date || null,
            fromGuest: latest.type === 'incoming' || latest.from === 'guest' || latest.direction === 'incoming',
          },
          totalMessages: msgArr.length,
        };
      } catch (e) {
        return null;
      }
    })
  );

  return {
    threads: threads
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value)
      .slice(0, limit),
  };
}

// ─────────────────────────────────────────────────────────────────
// AGGREGATED DASHBOARD
// Default: Year-to-date (Jan 1 to today)
// Accepts: ?from=YYYY-MM-DD&to=YYYY-MM-DD
// ─────────────────────────────────────────────────────────────────
export async function getDashboard(user, { from, to } = {}) {
  const today = new Date();

  // ── Default: Year-to-date ──
  const startOfYear = new Date(today.getFullYear(), 0, 1);
  const fmt = d => d.toISOString().slice(0, 10);

  const fromDate = from || fmt(startOfYear);
  const toDate   = to   || fmt(today);

  // Fetch data
  const [apartmentsData, bookingsData] = await Promise.all([
    getApartments(user),
    getBookings(user, { from: fromDate, to: toDate, showCancellation: true }),
  ]);

  const properties = apartmentsData.apartments || [];
  const allBookings = bookingsData.bookings || [];

  // ── Compute nights for a booking ──
  function computeNights(b) {
    if (!b.arrival || !b.departure) return 0;
    const ms = new Date(b.departure) - new Date(b.arrival);
    return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)));
  }

  // ── Aggregate stats ──
  let totalRevenue = 0;
  let totalNights = 0;
  let totalBookings = 0;
  let cancellations = 0;
  let cancellationNights = 0;
  const byChannel = {};

  allBookings.forEach(b => {
    const nights = computeNights(b);

    if (b.type === 'cancellation') {
      cancellations++;
      cancellationNights += nights;
      return;
    }

    // Skip blocked bookings (manual blocks, hindi totoong reservation)
    if (b['is-blocked-booking']) {
      return;
    }

    totalRevenue += Number(b.price) || 0;
    totalNights += nights;
    totalBookings++;

    const ch = b.channel?.name || 'Direct';
    byChannel[ch] = byChannel[ch] || { revenue: 0, bookings: 0, nights: 0 };
    byChannel[ch].revenue += Number(b.price) || 0;
    byChannel[ch].bookings += 1;
    byChannel[ch].nights += nights;
  });

  // ── Occupancy rate ──
  const daysInRange = Math.max(1, Math.round(
    (new Date(toDate) - new Date(fromDate)) / (1000 * 60 * 60 * 24)
  )) + 1; // inclusive
  const propsCount = properties.length || 1;
  const totalAvailableNights = daysInRange * propsCount;
  const occupancyPct = Math.min(100, Math.round((totalNights / totalAvailableNights) * 100));

  const inboxData = await getInbox(user, { limit: 5 }).catch(err => {
    console.warn('Inbox fetch failed:', err.message);
    return { threads: [] };
  });

  return {
    period: { from: fromDate, to: toDate, days: daysInRange },
    stats: {
      revenue: totalRevenue,
      bookings: totalBookings,
      cancellations,
      cancellationNights,
      nights: totalNights,
      occupancy: occupancyPct,
    },
    byChannel,
    properties,
    bookings: allBookings,
    inbox: inboxData.threads,
  };
}