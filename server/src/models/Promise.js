import mongoose from 'mongoose';

const promiseSchema = new mongoose.Schema({
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true,
    index: true,
  },
  tabIds: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Tab',
    },
  ],
  amount: {
    type: Number,
    default: null,
    min: 0,
  },
  dueDate: {
    type: Date,
    required: true,
    index: true,
  },
  dueDateStr: {
    type: String,
    default: null,
  },
  status: {
    type: String,
    enum: ['PENDING', 'KEPT', 'BROKEN', 'CANCELLED'],
    default: 'PENDING',
    index: true,
  },
  sourceMessageId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Message',
    default: null,
  },
  followedUpAt: {
    type: Date,
    default: null,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

export const CustomerPromise = mongoose.model('Promise', promiseSchema);
export { CustomerPromise as PromiseModel };

