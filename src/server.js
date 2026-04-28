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

app.set('trust proxy', 1);

app.use(helmet());
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: function (origin, cb) {
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('CORS: origin not allowed: ' + origin));
  },
  credentials: true,
}));

const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many auth attempts, try again later' },
});

app.use(generalLimiter);

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

app.use('/auth', authLimiter, authRoutes);
app.use('/api',  dashboardRoutes);

app.use((err, req, res, next) => {
  console.error('Error:', err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
  });
});

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

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