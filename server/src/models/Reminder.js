import mongoose from 'mongoose';

const reminderSchema = new mongoose.Schema({
  tabId: { type: mongoose.Schema.Types.ObjectId, ref: 'Tab', required: true, index: true },
  customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
  attempt: { type: Number, required: true, min: 1 },
  tone: { type: String, enum: ['gentle', 'firm'], required: true },
  channel: { type: String, enum: ['whatsapp'], default: 'whatsapp' },
  payLink: { type: String, required: true },
  message: { type: String, default: '' },
  sentAt: { type: Date, default: Date.now },
  status: { type: String, enum: ['SENT', 'FAILED', 'SKIPPED'], default: 'SENT' },
  error: { type: String, default: null },
});

export const Reminder = mongoose.model('Reminder', reminderSchema);

