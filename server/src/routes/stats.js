import express from 'express';
import { Tab, Vendor } from '../models/index.js';
import { emitSocketEvent } from '../sockets.js';

const router = express.Router();

/**
 * Deterministically compute today's live stall stats from MongoDB.
 */
export async function computeTodayStats() {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [todayPaidTabs, openAndAlertTabs, khataTabs] = await Promise.all([
    Tab.find({
      status: 'PAID',
      $or: [
        { paidAt: { $gte: startOfToday } },
        { paidAt: null, createdAt: { $gte: startOfToday } },
      ],
    }),
    Tab.find({ status: { $in: ['OPEN', 'ALERTED', 'PARTIAL'] } }),
    Tab.find({ status: 'KHATA' }),
  ]);

  const collected = todayPaidTabs.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  const paypalConfirmedToday = todayPaidTabs
    .filter((t) => t.paymentMethod === 'PAYPAL' && t.paypal?.captureId)
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  const cashRecordedToday = todayPaidTabs
    .filter((t) => t.paymentMethod === 'CASH')
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

  const pending = openAndAlertTabs.reduce((sum, t) => {
    const alreadyPaid = Number(t.paypal?.paidAmount || 0);
    return sum + Math.max(0, Number(t.amount || 0) - alreadyPaid);
  }, 0);

  const khata = khataTabs.reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
  const openCount = openAndAlertTabs.length;
  const alertedCount = openAndAlertTabs.filter((t) => t.status === 'ALERTED').length;

  return {
    collected,
    paypalConfirmedToday,
    cashRecordedToday,
    paidOrdersToday: todayPaidTabs.length,
    pending,
    khata,
    openCount,
    alertedCount,
    currency: process.env.CURRENCY_SYMBOL || '₹',
    paypalCurrency: process.env.PAYPAL_CURRENCY || 'INR',
  };
}

/**
 * Part B1: "Recovered by Bharosa" deterministic calculation.
 * Definition: a tab where `alertedAt` is set and it was later paid (`paidAt > alertedAt`),
 * counting only PayPal-confirmed (`paymentMethod === 'PAYPAL'` && `paypal.captureId`) or cash-recorded (`paymentMethod === 'CASH'`).
 */
export async function computeRecoveredStats(days = 7) {
  const numDays = Math.min(30, Math.max(1, Number(days) || 7));
  const now = new Date();
  const startDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - (numDays - 1),
    0,
    0,
    0,
    0
  );

  const vendor = await Vendor.findOne();
  const alertedTabsInRange = await Tab.find({
    alertedAt: { $ne: null, $gte: startDate },
  });

  let recoveredAmount = 0;
  let recoveredCount = 0;
  let hasSeedData = Boolean(vendor?.isDemoSeeded);

  for (const t of alertedTabsInRange) {
    if (String(t.paypal?.orderId || '').startsWith('SEED-')) {
      hasSeedData = true;
    }

    const isVerifiedPayPalOrCash =
      (t.paymentMethod === 'PAYPAL' && Boolean(t.paypal?.captureId)) ||
      t.paymentMethod === 'CASH';

    if (
      t.status === 'PAID' &&
      isVerifiedPayPalOrCash &&
      t.paidAt &&
      t.alertedAt &&
      new Date(t.paidAt).getTime() > new Date(t.alertedAt).getTime()
    ) {
      recoveredAmount += Number(t.amount) || 0;
      recoveredCount += 1;
    }
  }

  return {
    days: numDays,
    recoveredAmount,
    recoveredCount,
    alertedCount: alertedTabsInRange.length,
    currency: process.env.CURRENCY_SYMBOL || '₹',
    isDemoData: hasSeedData || process.env.DEV_MODE === 'true',
  };
}

export async function broadcastStatsUpdated() {
  try {
    const [stats, recovered] = await Promise.all([
      computeTodayStats(),
      computeRecoveredStats(7),
    ]);
    emitSocketEvent('stats:updated', { ...stats, recovered });
    return stats;
  } catch (err) {
    console.warn('[broadcastStatsUpdated] Error:', err.message);
    return null;
  }
}

/**
 * GET /api/stats/today
 */
router.get('/today', async (req, res) => {
  try {
    const stats = await computeTodayStats();
    return res.json(stats);
  } catch (err) {
    console.error('[GET /api/stats/today] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/stats/recovered?days=7
 * Returns { recoveredAmount, recoveredCount, alertedCount, currency, isDemoData }
 */
router.get('/recovered', async (req, res) => {
  try {
    const data = await computeRecoveredStats(req.query.days || 7);
    return res.json(data);
  } catch (err) {
    console.error('[GET /api/stats/recovered] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
