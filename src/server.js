// src/server.js
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';

import { connectDB } from './config/db.js';
import authRoutes from './routes/auth.js';
import dashboardRoutes from './routes/dashboard.js';

const app = express();
const PORT = process.env.PORT || 3000;

// ── Trust Render's proxy (for correct req.ip) ──────────────────
app.set('trust proxy', 1);

// ── Security middleware ───────────────────────────────────────
app.use(helmet());
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// ── CORS ──────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: function (origin, cb) {
    if (!origin) return cb(null, true); // curl, server-to-server
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('CORS: origin not allowed: ' + origin));
  },
  credentials: true, // important for refresh token cookie
}));

// ── Rate limiting (auth routes mas strict) ────────────────────
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 20,
  message: { error: 'Too many auth attempts, try again later' },
});

app.use(generalLimiter);

// ── Health check ──────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    service: 'HostPilot Backend',
    status: 'ok',
    version: '1.0.0',
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

// ── Routes ────────────────────────────────────────────────────
app.use('/auth', authLimiter, authRoutes);
app.use('/api',  dashboardRoutes);

// ── Error handler ─────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Error:', err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
  });
});

// ── 404 handler ───────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// ── Start ─────────────────────────────────────────────────────
async function start() {
  await connectDB();
  app.listen(PORT, () => {
    console.log(`✓ HostPilot backend listening on :${PORT}`);
    console.log(`  Allowed origins: ${allowedOrigins.join(', ') || '(none set)'}`);
  });
}

start().catch(err => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});