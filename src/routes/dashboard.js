// src/routes/dashboard.js
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  getApartments, getBookings, getRates, getDashboard,
  getReservationMessages, sendReplyToGuest
} from '../services/smoobu.js';

const router = express.Router();

// All routes here require auth
router.use(requireAuth);

// GET /api/dashboard
router.get('/dashboard', async (req, res, next) => {
  try {
    const data = await getDashboard(req.user, {
      from: req.query.from,
      to: req.query.to,
    });
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/properties
router.get('/properties', async (req, res, next) => {
  try {
    const data = await getApartments(req.user);
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/bookings?from=&to=&apartmentId=
router.get('/bookings', async (req, res, next) => {
  try {
    const data = await getBookings(req.user, req.query);
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/rates?apartmentIds=1,2&start=&end=
router.get('/rates', async (req, res, next) => {
  try {
    const { apartmentIds, start, end } = req.query;
    if (!apartmentIds || !start || !end) {
      return res.status(400).json({ error: 'apartmentIds, start, end required' });
    }
    const data = await getRates(req.user, {
      apartmentIds: apartmentIds.split(','),
      start, end,
    });
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/messages/reply — Send a reply to a guest
router.post('/messages/reply', async (req, res, next) => {
  try {
    const { reservationId, subject, messageBody } = req.body;
    if (!reservationId || !messageBody) {
      return res.status(400).json({ error: 'reservationId and messageBody are required' });
    }
    const result = await sendReplyToGuest(req.user, reservationId, { subject, messageBody });
    res.json({ success: true, ...result });
  } catch (err) {
    if (err.message.includes('Unauthorized')) {
      return res.status(403).json({ error: err.message });
    }
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    next(err);
  }
});

// GET /api/messages/:reservationId — Get full conversation
router.get('/messages/:reservationId', async (req, res, next) => {
  try {
    const data = await getReservationMessages(req.user, req.params.reservationId);
    res.json(data);
  } catch (err) {
    if (err.message.includes('Unauthorized')) {
      return res.status(403).json({ error: err.message });
    }
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    next(err);
  }
});

export default router;