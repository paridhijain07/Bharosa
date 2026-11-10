import express from 'express';
import { z } from 'zod';
import { Tab, Vendor } from '../models/index.js';
import { toLocalDateKey } from './income.js';

const router = express.Router();

const DateQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  lang: z.enum(['hi', 'en']).optional(),
});

/**
 * Deterministically compute Close-Day Summary from MongoDB for a given YYYY-MM-DD (default today).
 * The LLM / template only phrases one short spoken sentence from the already-computed facts.
 */
export async function buildDaySummary(dateStr) {
  const now = new Date();
  let targetYear = now.getFullYear();
  let targetMonth = now.getMonth();
  let targetDay = now.getDate();

  if (dateStr && /^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    const [y, m, d] = dateStr.split('-').map(Number);
    targetYear = y;
    targetMonth = m - 1;
    targetDay = d;
  }

  const dayStart = new Date(targetYear, targetMonth, targetDay, 0, 0, 0, 0);
  const dayEnd = new Date(targetYear, targetMonth, targetDay, 23, 59, 59, 999);
  const resolvedDateStr = toLocalDateKey(dayStart);

  const vendor = await Vendor.findOne();
  const [dayTabs, allKhataTabs] = await Promise.all([
    Tab.find({
      $or: [
        { createdAt: { $gte: dayStart, $lte: dayEnd } },
        { paidAt: { $gte: dayStart, $lte: dayEnd } },
      ],
    }).populate('customerId'),
    Tab.find({ status: 'KHATA' }).populate('customerId'),
  ]);

  let paypalCollected = 0;
  let cashCollected = 0;
  let paypalOrderCount = 0;
  let cashOrderCount = 0;
  let paidOrdersCount = 0;
  let pendingAmount = 0;
  let unpaidAtCloseCount = 0;
  let recoveredAmount = 0;
  let recoveredCount = 0;
  let hasSeedData = Boolean(vendor?.isDemoSeeded);

  for (const t of dayTabs) {
    const amt = Number(t.amount) || 0;
    if (String(t.paypal?.orderId || '').startsWith('SEED-')) {
      hasSeedData = true;
    }

    if (t.status === 'PAID') {
      paidOrdersCount += 1;
      if (t.paymentMethod === 'PAYPAL' && t.paypal?.captureId) {
        paypalCollected += amt;
        paypalOrderCount += 1;
      } else {
        cashCollected += amt;
        cashOrderCount += 1;
      }

      if (
        t.alertedAt &&
        t.paidAt &&
        new Date(t.paidAt).getTime() > new Date(t.alertedAt).getTime()
      ) {
        recoveredAmount += amt;
        recoveredCount += 1;
      }
    } else if (['OPEN', 'ALERTED', 'PARTIAL'].includes(t.status)) {
      const paidSoFar = Number(t.paypal?.paidAmount || 0);
      pendingAmount += Math.max(0, amt - paidSoFar);
      unpaidAtCloseCount += 1;
    }
  }

  const totalCollected = paypalCollected + cashCollected;
  const khataOutstanding = allKhataTabs.reduce(
    (sum, t) => sum + (Number(t.amount) || 0),
    0
  );
  const currency = process.env.CURRENCY_SYMBOL || '₹';

  const spokenHi = `आज ${paidOrdersCount} ऑर्डर से कुल ${currency}${totalCollected} आए (${currency}${paypalCollected} PayPal और ${currency}${cashCollected} कैश)। अलर्ट से ${currency}${recoveredAmount} की वसूली हुई, ${unpaidAtCloseCount} ऑर्डर बाकी हैं, और खाते में कुल ${currency}${khataOutstanding} उधार है।`;
  const spokenEn = `Today you collected ${currency}${totalCollected} across ${paidOrdersCount} orders (${currency}${paypalCollected} PayPal verified, ${currency}${cashCollected} cash). Bharosa alerts recovered ${currency}${recoveredAmount}, ${unpaidAtCloseCount} orders remain unpaid, and ${currency}${khataOutstanding} is outstanding in Khata.`;

  return {
    date: resolvedDateStr,
    vendorName: vendor?.name || 'Sharma Ji Chaat & Chai Stall',
    currency,
    currencySymbol: currency,
    totalCollected,
    paypalCollected,
    cashCollected,
    paypalOrderCount,
    cashOrderCount,
    paidOrdersCount,
    totalOrders: dayTabs.length,
    totalOrdersCount: dayTabs.length,
    pendingAmount,
    unpaidAtCloseCount,
    khataOutstanding,
    khataOutstandingTotal: khataOutstanding,
    recoveredAmount,
    recoveredCount,
    isDemoData: hasSeedData || process.env.DEV_MODE === 'true',
    spokenHi,
    spokenEn,
  };
}

/**
 * GET /api/day/summary?date=YYYY-MM-DD
 */
router.get('/summary', async (req, res) => {
  try {
    const parsed = DateQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid date format (use YYYY-MM-DD)' });
    }
    const summary = await buildDaySummary(parsed.data.date);
    return res.json(summary);
  } catch (err) {
    console.error('[GET /api/day/summary] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
