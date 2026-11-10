import express from 'express';
import { z } from 'zod';
import { Customer, Tab, Reminder, Message, CustomerPromise } from '../models/index.js';

const router = express.Router();

const CreateCustomerSchema = z.object({
  name: z.string().min(1),
  phone: z.string().regex(/^\+[1-9]\d{6,14}$/, 'Phone must be in E.164 format (e.g. +919876543210)'),
  whatsappConsent: z.boolean().default(true),
  creditLimit: z.number().min(0).nullable().optional(),
});

/**
 * Part B4: Transparent, deterministic Smart Credit Limit rule.
 * Computes from customer's historical khata tabs:
 * - khataCount: total khata tabs (settled + open)
 * - settledCount: number of paid khata tabs
 * - repaymentRate: settledCount / khataCount (0..1)
 * - avgDaysToRepay: average days between `createdAt` and `paidAt` on settled khata tabs
 * - currentOutstanding: sum of unpaid `status === 'KHATA'` tabs
 * - largestSettled: max amount among settled khata tabs
 *
 * Rule:
 * 1. Base anchor = `round((avgSettled + largestSettled) / 2) * 2.5` (or ₹200 starter baseline if no settled history).
 * 2. Scale by repayment rate (`0.5 + 0.5 * repaymentRate`).
 * 3. Speed bonus: if `avgDaysToRepay <= 3`, multiply by `1.15`; if `avgDaysToRepay > 7`, multiply by `0.8`.
 * 4. Overdue cool-down: if `currentOutstanding > 0`, reduce by `15%` (or `35%` if any open khata is older than 7 days).
 * 5. Round to nearest ₹50 and clamp between ₹100 and ₹2000.
 */
export function computeSmartCreditSuggestion(customerName, customerTabs = [], isDemoSeeded = false) {
  const khataTabs = customerTabs.filter(
    (t) => t.mode === 'KHATA' || t.status === 'KHATA'
  );
  const settledTabs = khataTabs.filter((t) => t.status === 'PAID');
  const openTabs = khataTabs.filter((t) => t.status === 'KHATA');

  const khataCount = khataTabs.length;
  const settledCount = settledTabs.length;
  const repaymentRate = khataCount > 0 ? Number((settledCount / khataCount).toFixed(2)) : 1;

  const currentOutstanding = openTabs.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const largestSettled = settledTabs.reduce(
    (max, t) => Math.max(max, Number(t.amount) || 0),
    0
  );
  const avgSettled =
    settledCount > 0
      ? settledTabs.reduce((s, t) => s + (Number(t.amount) || 0), 0) / settledCount
      : 0;

  let totalRepayDays = 0;
  let repaySamples = 0;
  let hasSeedOrder = Boolean(isDemoSeeded);

  for (const t of settledTabs) {
    if (String(t.paypal?.orderId || '').startsWith('SEED-')) {
      hasSeedOrder = true;
    }
    if (t.createdAt && t.paidAt) {
      const diffDays = Math.max(
        0.5,
        (new Date(t.paidAt).getTime() - new Date(t.createdAt).getTime()) /
          (1000 * 60 * 60 * 24)
      );
      totalRepayDays += diffDays;
      repaySamples += 1;
    }
  }

  const avgDaysToRepay =
    repaySamples > 0 ? Math.max(1, Math.round(totalRepayDays / repaySamples)) : 2;

  // Compute base limit
  const rawBase =
    settledCount > 0 ? ((avgSettled + largestSettled) / 2) * 3.2 : 200;

  const rateMultiplier = 0.5 + 0.5 * repaymentRate;
  const speedMultiplier = avgDaysToRepay <= 3 ? 1.15 : avgDaysToRepay > 7 ? 0.8 : 1.0;

  const nowMs = Date.now();
  const hasOldOpenKhata = openTabs.some(
    (t) => nowMs - new Date(t.createdAt).getTime() > 7 * 24 * 3600 * 1000
  );
  const cooldownMultiplier = hasOldOpenKhata
    ? 0.65
    : currentOutstanding > 0
      ? 0.9
      : 1.0;

  const rawSuggested = rawBase * rateMultiplier * speedMultiplier * cooldownMultiplier;
  const suggestedLimit = Math.min(
    2000,
    Math.max(100, Math.round(rawSuggested / 50) * 50)
  );

  const currency = process.env.CURRENCY_SYMBOL || '₹';
  const reasons = [];

  if (settledCount > 0) {
    reasons.push(
      `Settled ${settledCount} of ${khataCount} khata orders (${Math.round(repaymentRate * 100)}% repayment rate)`
    );
    reasons.push(`Usually repays in ~${avgDaysToRepay} day${avgDaysToRepay === 1 ? '' : 's'}`);
    reasons.push(`Largest settled khata: ${currency}${largestSettled}`);
  } else {
    reasons.push('Starter limit based on new regular profile');
  }

  if (currentOutstanding > 0) {
    reasons.push(`Current pending balance: ${currency}${currentOutstanding}`);
  }

  const friendlyEn =
    settledCount > 0
      ? `${customerName} usually pays in about ${avgDaysToRepay} days (${Math.round(repaymentRate * 100)}% settled). Safe up to ${currency}${suggestedLimit}.`
      : `${customerName} has no settled khata history yet. Safe starter limit up to ${currency}${suggestedLimit}.`;

  const friendlyHi =
    settledCount > 0
      ? `${customerName} आमतौर पर ${avgDaysToRepay} दिन में भुगतान करते हैं (${Math.round(repaymentRate * 100)}% रिकॉर्ड)। ${currency}${suggestedLimit} तक उधार सुरक्षित है।`
      : `${customerName} के लिए शुरुआती सुरक्षित उधार सीमा ${currency}${suggestedLimit} है।`;

  return {
    suggestedLimit,
    reasons,
    friendlyEn,
    friendlyHi,
    isDemoData: hasSeedOrder || process.env.DEV_MODE === 'true',
    stats: {
      khataCount,
      settledCount,
      repaymentRate,
      avgDaysToRepay,
      currentOutstanding,
      largestSettled,
    },
  };
}

/**
 * GET /api/customers
 * Returns all regular customers enriched with their outstanding khata balance, reminder history, and smart credit suggestion.
 */
router.get('/', async (req, res) => {
  try {
    const customers = await Customer.find().sort({ createdAt: 1 });
    const [allCustomerTabs, reminders, allMessages, allPromises] = await Promise.all([
      Tab.find({ customerId: { $ne: null } }).sort({ createdAt: -1 }),
      Reminder.find().sort({ sentAt: -1 }),
      Message.find().sort({ createdAt: 1 }),
      CustomerPromise.find({ status: { $in: ['PENDING', 'BROKEN', 'KEPT'] } }).sort({
        createdAt: -1,
      }),
    ]);

    const enriched = customers.map((c) => {
      const custTabs = allCustomerTabs.filter(
        (t) => String(t.customerId) === String(c._id)
      );
      const openKhataTabs = custTabs.filter((t) =>
        ['KHATA', 'PARTIAL'].includes(t.status)
      );
      const outstandingBalance = openKhataTabs.reduce(
        (sum, t) => sum + Math.max(0, Number(t.amount) - Number(t.paypal?.paidAmount || 0)),
        0
      );
      const customerReminders = reminders.filter(
        (r) => String(r.customerId) === String(c._id)
      );
      const lastReminder = customerReminders[0] || null;
      const messages = allMessages
        .filter((m) => String(m.customerId) === String(c._id))
        .slice(-20);
      const activePromise =
        allPromises.find(
          (p) =>
            String(p.customerId) === String(c._id) &&
            ['PENDING', 'BROKEN'].includes(p.status)
        ) || null;
      const creditSuggestion = computeSmartCreditSuggestion(
        c.name,
        custTabs,
        c.isDemoSeeded
      );

      return {
        ...c.toObject(),
        outstandingBalance,
        openKhataTabs,
        reminderCount: customerReminders.filter((r) => r.status === 'SENT').length,
        lastReminder,
        messages,
        activePromise,
        creditSuggestion,
      };
    });

    return res.json({ customers: enriched });
  } catch (err) {
    console.error('[GET /api/customers] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/customers/:id/messages
 * Returns the customer's two-way WhatsApp message history and active promises
 */
router.get('/:id/messages', async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    const [messages, promises] = await Promise.all([
      Message.find({ customerId: customer._id }).sort({ createdAt: 1 }).limit(30),
      CustomerPromise.find({
        customerId: customer._id,
        status: { $in: ['PENDING', 'BROKEN', 'KEPT'] },
      }).sort({ createdAt: -1 }),
    ]);
    return res.json({
      customerId: customer._id,
      customerName: customer.name,
      messages,
      promises,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/customers/:id/credit-suggestion
 * Returns { suggestedLimit, reasons[], stats, friendlyEn, friendlyHi, isDemoData }
 */
router.get('/:id/credit-suggestion', async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    const custTabs = await Tab.find({ customerId: customer._id }).sort({
      createdAt: -1,
    });
    const suggestion = computeSmartCreditSuggestion(
      customer.name,
      custTabs,
      customer.isDemoSeeded
    );
    return res.json({
      customerId: customer._id,
      customerName: customer.name,
      currentCreditLimit: customer.creditLimit,
      ...suggestion,
    });
  } catch (err) {
    console.error('[GET /api/customers/:id/credit-suggestion] Error:', err.message);
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/customers
 */
router.post('/', async (req, res) => {
  try {
    const parsed = CreateCustomerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid customer data',
        details: parsed.error.flatten(),
      });
    }

    const { name, phone, whatsappConsent, creditLimit } = parsed.data;
    let customer = await Customer.findOne({ name: new RegExp(`^${name.trim()}$`, 'i') });
    if (customer) {
      customer.phone = phone;
      customer.whatsappConsent = whatsappConsent;
      if (creditLimit !== undefined) customer.creditLimit = creditLimit;
      await customer.save();
    } else {
      customer = await Customer.create({
        name: name.trim(),
        phone,
        whatsappConsent,
        creditLimit: creditLimit ?? null,
      });
    }

    return res.status(201).json({ customer });
  } catch (err) {
    console.error('[POST /api/customers] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/customers/:id
 * Toggle WhatsApp consent, update phone, or accept/edit creditLimit
 */
router.patch('/:id', async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    if (typeof req.body.whatsappConsent === 'boolean') {
      customer.whatsappConsent = req.body.whatsappConsent;
    }
    if (req.body.phone) {
      customer.phone = req.body.phone;
    }
    if (req.body.creditLimit !== undefined) {
      customer.creditLimit =
        req.body.creditLimit === null ? null : Math.max(0, Number(req.body.creditLimit));
    }
    await customer.save();
    return res.json({ customer });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

export default router;
