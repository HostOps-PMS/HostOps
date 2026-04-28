// src/services/smoobu.js
//
// Smoobu API wrapper na may caching at per-user filtering.
// Single-Smoobu mode: lahat tumatawag using SMOOBU_API_KEY,
// pero ang results are filtered by user.propertyTagPrefix.

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

export async function getApartments(user) {
  const apiKey = getApiKeyForUser(user);
  const data = await smoobuRequest('/apartments', apiKey);
  const filtered = (data.apartments || [])
    .filter(a => belongsToUser(a.name, user))
    .map(a => ({ ...a, name: displayName(a.name, user) }));
  return { apartments: filtered };
}

export async function getBookings(user, { from, to, apartmentId, page = 1, pageSize = 100 } = {}) {
  const apiKey = getApiKeyForUser(user);

  const apartmentsData = await smoobuRequest('/apartments', apiKey);
  const userApartmentIds = new Set(
    (apartmentsData.apartments || [])
      .filter(a => belongsToUser(a.name, user))
      .map(a => a.id)
  );

  const params = new URLSearchParams();
  if (from) params.append('from', from);
  if (to)   params.append('to', to);
  if (apartmentId) params.append('apartmentId', apartmentId);
  params.append('page', page);
  params.append('pageSize', pageSize);
  params.append('excludeBlocked', 'true');

  const data = await smoobuRequest(`/reservations?${params}`, apiKey);

  const bookings = (data.bookings || [])
    .filter(b => userApartmentIds.has(b.apartment?.id))
    .map(b => ({
      ...b,
      apartment: {
        ...b.apartment,
        name: displayName(b.apartment.name, user),
      },
    }));

  return { ...data, bookings };
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

export async function getDashboard(user, { from, to } = {}) {
  const today = new Date();
  const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const lastOfMonth  = new Date(today.getFullYear(), today.getMonth() + 1, 0);
  const fmt = d => d.toISOString().slice(0, 10);
  const fromDate = from || fmt(firstOfMonth);
  const toDate   = to   || fmt(lastOfMonth);

  const [apartmentsData, bookingsData] = await Promise.all([
    getApartments(user),
    getBookings(user, { from: fromDate, to: toDate }),
  ]);

  const properties = apartmentsData.apartments || [];
  const bookings   = bookingsData.bookings || [];

  let totalRevenue  = 0;
  let totalNights   = 0;
  let cancellations = 0;
  const byChannel   = {};

  bookings.forEach(b => {
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

  const daysInRange = Math.max(1, Math.round(
    (new Date(toDate) - new Date(fromDate)) / (1000 * 60 * 60 * 24)
  ));
  const propsCount = properties.length || 1;
  const totalAvailableNights = daysInRange * propsCount;
  const occupancyPct = Math.min(100, Math.round((totalNights / totalAvailableNights) * 100));

  return {
    period: { from: fromDate, to: toDate },
    stats: {
      revenue: totalRevenue,
      bookings: bookings.filter(b => b.type !== 'cancellation').length,
      cancellations,
      nights: totalNights,
      occupancy: occupancyPct,
    },
    byChannel,
    properties,
    bookings,
  };
}