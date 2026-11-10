import mongoose from 'mongoose';

const customerSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: {
      type: String,
      required: true,
      trim: true,
      match: [/^\+[1-9]\d{6,14}$/, 'Phone must be in E.164 format (e.g. +919876543210)'],
    },
    whatsappConsent: { type: Boolean, default: false },
    creditLimit: { type: Number, default: null, min: 0 },
    collectorStatus: {
      type: String,
      enum: ['NONE', 'PROMISED', 'NEEDS_VENDOR', 'DISPUTED', 'OPTED_OUT'],
      default: 'NONE',
    },
    collectorNote: { type: String, default: null },
    lastOutboundAt: { type: Date, default: null },
    reminderCountWeek: { type: Number, default: 0 },
    isDemoSeeded: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: false }
);

export const Customer = mongoose.model('Customer', customerSchema);
