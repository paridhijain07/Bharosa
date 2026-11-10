import crypto from 'crypto';
import express from 'express';
import { Tab, Vendor } from '../models/index.js';

const router = express.Router();

/**
 * Format a Date object into a local YYYY-MM-DD calendar key (avoids UTC offset shift bugs).
 */
export function toLocalDateKey(dateObj) {
  const d = new Date(dateObj);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export async function buildIncomeReport(days = 7, includeToken = true) {
  const numDays = Math.min(30, Math.max(1, Number(days) || 7));
  let vendor = await Vendor.findOne();
  if (vendor && !vendor.shareToken) {
    vendor.shareToken = crypto.randomBytes(16).toString('hex');
    await vendor.save();
  }

  const now = new Date();
  const endDate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const startDate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - (numDays - 1),
    0,
    0,
    0,
    0
  );

  // Build exactly `numDays` daily buckets from oldest to newest using local calendar dates
  const dailyMap = new Map();
  for (let i = 0; i < numDays; i++) {
    const d = new Date(
      startDate.getFullYear(),
      startDate.getMonth(),
      startDate.getDate() + i,
      12,
      0,
      0,
      0
    );
    const key = toLocalDateKey(d);
    dailyMap.set(key, {
      date: key,
      labelEn: d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' }),
      labelHi: d.toLocaleDateString('hi-IN', { weekday: 'short', day: 'numeric' }),
      paypalVerified: 0,
      cashRecorded: 0,
      total: 0,
      orderCount: 0,
    });
  }

  // Query all PAID tabs and bucket by their local calendar date (createdAt or paidAt within range)
  const paidTabs = await Tab.find({ status: 'PAID' }).sort({ createdAt: 1 });

  let totalPaypalVerified = 0;
  let totalCashRecorded = 0;
  let orderCount = 0;
  let hasSeedData = Boolean(vendor?.isDemoSeeded);

  for (const t of paidTabs) {
    // Use createdAt for the order's business day so multi-day khata settlements still match the day or use paidAt if createdAt isn't in bucket
    const createdKey = toLocalDateKey(t.createdAt);
    const paidKey = t.paidAt ? toLocalDateKey(t.paidAt) : createdKey;
    const bucket = dailyMap.get(createdKey) || dailyMap.get(paidKey);

    if (!bucket) continue;

    const amt = Number(t.amount) || 0;
    const isPaypal = t.paymentMethod === 'PAYPAL' && Boolean(t.paypal?.captureId);

    if (String(t.paypal?.orderId || '').startsWith('SEED-')) {
      hasSeedData = true;
    }

    if (isPaypal) {
      totalPaypalVerified += amt;
      bucket.paypalVerified += amt;
    } else {
      totalCashRecorded += amt;
      bucket.cashRecorded += amt;
    }

    bucket.total += amt;
    bucket.orderCount += 1;
    orderCount += 1;
  }

  const daily = Array.from(dailyMap.values());
  const weeklyTotal = totalPaypalVerified + totalCashRecorded;
  const averageOrderValue = orderCount > 0 ? Math.round(weeklyTotal / orderCount) : 0;

  // Compute PayPal Working Capital & Micro-Loan Readiness Score from real DB metrics
  const allKhataTabs = await Tab.find({
    $or: [{ mode: 'KHATA' }, { status: 'KHATA' }, { reminderCount: { $gt: 0 } }],
  });
  const settledKhataCount = allKhataTabs.filter((t) => t.status === 'PAID').length;
  const khataRecoveryRatePct =
    allKhataTabs.length > 0
      ? Math.round((settledKhataCount / allKhataTabs.length) * 100)
      : 100;

  const digitalRatioPct =
    weeklyTotal > 0 ? Math.round((totalPaypalVerified / weeklyTotal) * 100) : 0;
  const activeDaysCount = daily.filter((d) => d.total > 0).length;
  const consistencyPct = Math.round((activeDaysCount / numDays) * 100);

  // Composite Bharosa Trust Score (300 to 900 scale, similar to CIBIL + PayPal Merchant Score)
  const rawScore =
    350 +
    Math.round((digitalRatioPct / 100) * 260) +
    Math.round((consistencyPct / 100) * 170) +
    Math.round((khataRecoveryRatePct / 100) * 120);
  const bharosaScore = Math.min(900, Math.max(300, rawScore));

  // Pre-qualified PayPal Working Capital advance based on verified weekly run-rate
  const estimatedMonthlyVerified = Math.round((totalPaypalVerified / Math.max(1, numDays)) * 30);
  const rawOffer = Math.max(5000, Math.round((estimatedMonthlyVerified * 0.65) / 500) * 500);
  const preApprovedLimit = Math.min(50000, rawOffer);

  const workingCapital = {
    bharosaScore,
    maxScore: 900,
    tier: bharosaScore >= 760 ? 'GOLD' : bharosaScore >= 640 ? 'SILVER' : 'STARTER',
    preApprovedLimit,
    repaymentSharePct: 10,
    digitalRatioPct,
    activeDaysCount,
    totalDays: numDays,
    consistencyPct,
    khataRecoveryRatePct,
  };

  return {
    vendorName: vendor?.name || 'Sharma Ji Chaat & Chai Stall',
    days: numDays,
    currencySymbol: process.env.CURRENCY_SYMBOL || '₹',
    paypalCurrency: process.env.PAYPAL_CURRENCY || 'INR',
    weeklyTotal,
    paypalVerified: totalPaypalVerified,
    cashRecorded: totalCashRecorded,
    orderCount,
    averageOrderValue,
    daily,
    workingCapital,
    isDemoData: hasSeedData || process.env.DEV_MODE === 'true',
    shareToken: includeToken ? vendor?.shareToken || null : undefined,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * GET /api/income?days=7
 */
router.get('/', async (req, res) => {
  try {
    const report = await buildIncomeReport(req.query.days || 7, true);
    return res.json(report);
  } catch (err) {
    console.error('[GET /api/income] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/income/public/:token
 */
router.get('/public/:token', async (req, res) => {
  try {
    const token = String(req.params.token || '').trim();
    const vendor = await Vendor.findOne({ shareToken: token });
    if (!vendor) {
      return res.status(404).json({ error: 'Invalid or expired income statement share link' });
    }
    const report = await buildIncomeReport(req.query.days || 7, false);
    return res.json(report);
  } catch (err) {
    console.error('[GET /api/income/public/:token] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
