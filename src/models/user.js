// src/models/User.js
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
  },
  password: {
    type: String,
    required: true,
    select: false, // hindi babalik sa default queries
  },
  firstName: { type: String, required: true, trim: true },
  lastName:  { type: String, default: '', trim: true },

  // Email verification
  isVerified:        { type: Boolean, default: false },
  verifyToken:       { type: String, select: false },
  verifyTokenExpiry: { type: Date,   select: false },

  // Password reset
  resetToken:       { type: String, select: false },
  resetTokenExpiry: { type: Date,   select: false },

  // Roles
  role: {
    type: String,
    enum: ['client', 'admin'],
    default: 'client',
  },

  // ── MULTI-TENANT READY ────────────────────────────────────────
  // Single-Smoobu mode: lahat ng users may same SMOOBU_API_KEY
  // pero may sariling propertyTagPrefix para sa data filtering.
  //
  // Halimbawa: si Charmaine, propertyTagPrefix = "charmaine_"
  // Yung properties niya sa Smoobu, naka-prefix ng "charmaine_BGC Studio"
  // Sa kanyang dashboard, makikita lang niya yung properties na
  // nagsisimula sa "charmaine_".
  //
  // Future multi-Smoobu mode: gagamitin natin yung smoobuApiKey
  // (encrypted) at ihahanda na yung schema.
  propertyTagPrefix: { type: String, default: '', trim: true },

  // For future multi-Smoobu — encrypted bago i-store
  smoobuApiKey:      { type: String, select: false, default: null },
  smoobuConnectedAt: { type: Date,   default: null },

  // Activity tracking
  lastLoginAt: { type: Date },
}, {
  timestamps: true,
});

// ── Hash password before save ─────────────────────────────────
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// ── Compare password ──────────────────────────────────────────
userSchema.methods.comparePassword = async function(plain) {
  return bcrypt.compare(plain, this.password);
};

// ── Sanitize for API response ─────────────────────────────────
userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  delete obj.verifyToken;
  delete obj.verifyTokenExpiry;
  delete obj.resetToken;
  delete obj.resetTokenExpiry;
  delete obj.smoobuApiKey;
  delete obj.__v;
  return obj;
};

export default mongoose.model('user', userSchema);