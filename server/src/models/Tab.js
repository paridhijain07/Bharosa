import mongoose from 'mongoose';

const tabItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    qty: { type: Number, required: true, min: 1 },
    unitPrice: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const tabSchema = new mongoose.Schema({
  number: { type: Number, required: true, index: true },
  items: { type: [tabItemSchema], required: true },
  amount: { type: Number, required: true, min: 0 },
  currency: { type: String, default: 'USD' },
  status: {
    type: String,
    enum: ['OPEN', 'PAID', 'ALERTED', 'KHATA', 'PARTIAL', 'REFUNDED', 'CANCELLED'],
    default: 'OPEN',
    index: true,
  },
  mode: {
    type: String,
    enum: ['PAY_NOW', 'KHATA'],
    default: 'PAY_NOW',
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    default: null,
  },
  paypal: {
    orderId: { type: String, default: null, index: true },
    approvalUrl: { type: String, default: null },
    captureId: { type: String, default: null },
    paidAmount: { type: Number, default: 0 },
  },
  paymentMethod: {
    type: String,
    enum: ['PAYPAL', 'CASH', null],
    default: null,
  },
  alertAfterSeconds: {
    type: Number,
    default: null,
  },
  disputed: {
    type: Boolean,
    default: false,
  },
  disputedAt: {
    type: Date,
    default: null,
  },
  createdAt: { type: Date, default: Date.now, index: true },
  paidAt: { type: Date, default: null },
  alertedAt: { type: Date, default: null },
});

export const Tab = mongoose.model('Tab', tabSchema);

