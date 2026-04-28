// src/routes/dashboard.js
import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  getApartments, getBookings, getRates, getDashboard
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

export default router;