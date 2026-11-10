import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
    index: true,
  },
  direction: {
    type: String,
    enum: ['IN', 'OUT'],
    required: true,
  },
  body: {
    type: String,
    required: true,
    trim: true,
  },
  twilioSid: {
    type: String,
    default: null,
    index: true,
  },
  intent: {
    type: String,
    enum: [
      'PROMISE_DATE',
      'PARTIAL_NOW',
      'PAYING_NOW',
      'DISPUTE',
      'OPT_OUT',
      'QUESTION',
      'OTHER',
      null,
    ],
    default: null,
  },
  queuedForMorning: {
    type: Boolean,
    default: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
    index: true,
  },
});

export const Message = mongoose.model('Message', messageSchema);

