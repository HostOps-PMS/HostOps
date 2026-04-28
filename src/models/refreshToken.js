// src/models/RefreshToken.js
import mongoose from 'mongoose';

const refreshTokenSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  token: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  expiresAt: {
    type: Date,
    required: true,
    // MongoDB TTL index — auto-delete after expiry
    index: { expires: 0 },
  },
  revokedAt: { type: Date, default: null },
  replacedBy: { type: String, default: null }, // for rotation tracking
  ipAddress:  { type: String },
  userAgent:  { type: String },
}, {
  timestamps: true,
});

refreshTokenSchema.methods.isActive = function() {
  return !this.revokedAt && this.expiresAt > new Date();
};

export default mongoose.model('RefreshToken', refreshTokenSchema);