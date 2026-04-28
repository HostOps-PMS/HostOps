// src/config/db.js
import mongoose from 'mongoose';

export async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
    });
    console.log('✓ MongoDB connected:', mongoose.connection.name);
  } catch (err) {
    console.error('✗ MongoDB connection error:', err.message);
    process.exit(1);
  }

  mongoose.connection.on('disconnected', () => {
    console.warn('⚠ MongoDB disconnected');
  });
  mongoose.connection.on('error', (err) => {
    console.error('MongoDB error:', err);
  });
}