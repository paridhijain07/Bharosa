import crypto from 'crypto';
import mongoose from 'mongoose';

const menuItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    emoji: { type: String, default: '🍲' },
    aliases: [{ type: String, trim: true }],
    price: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const vendorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    language: { type: String, enum: ['hi', 'en'], default: 'hi' },
    shareToken: {
      type: String,
      default: () => crypto.randomBytes(16).toString('hex'),
      index: true,
    },
    isDemoSeeded: { type: Boolean, default: true },
    adaptiveAlertsEnabled: { type: Boolean, default: true },
    menu: [menuItemSchema],
  },
  { timestamps: true }
);

export const Vendor = mongoose.model('Vendor', vendorSchema);
