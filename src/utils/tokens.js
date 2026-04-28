// src/utils/tokens.js
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// ── Access tokens (short-lived, sent on every request) ──────────
export function signAccessToken(user) {
  return jwt.sign(
    {
      sub: user._id.toString(),
      email: user.email,
      role: user.role,
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m' }
  );
}

export function verifyAccessToken(token) {
  return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
}

// ── Refresh tokens (long-lived, stored in DB) ───────────────────
export function signRefreshToken(user) {
  return jwt.sign(
    { sub: user._id.toString() },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES || '7d' }
  );
}

export function verifyRefreshToken(token) {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET);
}

// ── Compute expiry Date object for refresh token ────────────────
export function refreshTokenExpiry() {
  const days = parseInt(process.env.JWT_REFRESH_EXPIRES || '7d');
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

// ── Random tokens (verify, reset) ───────────────────────────────
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

// ── Hash token for DB storage (so DB compromise ≠ token leak) ──
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}