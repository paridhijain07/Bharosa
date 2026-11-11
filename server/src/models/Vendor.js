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
    ownerName: { type: String, default: 'Sharma Ji', trim: true },
    phone: { type: String, default: '+919811122233', trim: true },
    category: {
      type: String,
      enum: ['chaat', 'cafeteria', 'juice', 'tea', 'custom'],
      default: 'chaat',
    },
    city: { type: String, default: 'New Delhi', trim: true },
    paypalEmail: { type: String, default: 'sharmaji-stall@business.example.com', trim: true },
    paypalMerchantId: { type: String, default: 'PPMERCHANT-IN-SHARMA01', trim: true },
    paypalConnected: { type: Boolean, default: true },
    onboardingCompleted: { type: Boolean, default: true },
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
