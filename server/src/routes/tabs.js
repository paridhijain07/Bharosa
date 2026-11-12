import express from 'express';
import { z } from 'zod';
import { Tab, Vendor, Customer } from '../models/index.js';
import { DEFAULT_MENU } from '../services/seed.js';
import { parseVoiceOrder, resolveUsualOrderFromTabs } from '../services/llm.js';
import { createPayPalOrder, refundPayPalCapture } from '../services/paypal.js';
import { resolveAlertSecondsForNewTab } from '../services/alerts.js';
import { markPromisesKeptIfSettled } from '../services/collector.js';
import { emitSocketEvent } from '../sockets.js';
import { broadcastStatsUpdated } from './stats.js';

const router = express.Router();

const ParseInputSchema = z.object({
  text: z.string(),
});

const CreateTabInputSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().min(1),
        qty: z.number().int().min(1),
        unitPrice: z.number().min(0),
      })
    )
    .min(1),
  amount: z.number().min(0),
  mode: z.enum(['PAY_NOW', 'KHATA']).default('PAY_NOW'),
  customerId: z.string().nullable().optional(),
  customerName: z.string().nullable().optional(),
});

const PatchTabInputSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().min(1),
        qty: z.number().int().min(1),
        unitPrice: z.number().min(0),
      })
    )
    .optional(),
  amount: z.number().min(0).optional(),
  status: z.enum(['CANCELLED']).optional(),
  markCashReceived: z.boolean().optional(),
});

/**
 * POST /api/tabs/parse
 * Parses voice transcript into structured items, amount, mode, and confidence.
 */
router.post('/parse', async (req, res) => {
  try {
    const parsedInput = ParseInputSchema.safeParse(req.body);
    if (!parsedInput.success) {
      return res.status(400).json({ error: 'Invalid input: text string is required' });
    }

    const vendor = await Vendor.findOne();
    const customers = await Customer.find();
    const activeMenu =
      vendor?.menu && vendor.menu.length > 0 ? vendor.menu : DEFAULT_MENU;
    const result = await parseVoiceOrder(parsedInput.data.text, activeMenu, customers);

    // Resolve customerId if customerName matched a known customer
    let matchedCustomer = null;
    if (result.customerName) {
      matchedCustomer = customers.find(
        (c) => c.name.toLowerCase() === result.customerName.toLowerCase()
      );
    }

    // Part B3: If `usual === true` ("Raju ka roz wala" / "Raju's usual"), resolve from customer's last 10 tabs
    if (result.usual) {
      if (!matchedCustomer) {
        const displayName = result.customerName || 'Customer';
        return res.json({
          ...result,
          items: [],
          amount: 0,
          customerId: null,
          customer: null,
          needsConfirmation: true,
          reason: `No usual order found for ${displayName}`,
        });
      }

      const lastTabs = await Tab.find({ customerId: matchedCustomer._id })
        .sort({ createdAt: -1 })
        .limit(10);

      const resolved = resolveUsualOrderFromTabs(
        lastTabs,
        vendor?.menu || [],
        matchedCustomer.name
      );

      return res.json({
        ...result,
        items: resolved.items,
        amount: resolved.amount,
        customerName: matchedCustomer.name,
        customerId: matchedCustomer._id,
        customer: matchedCustomer,
        usual: true,
        usualFound: resolved.found,
        needsConfirmation: resolved.needsConfirmation,
        reason: resolved.reason,
      });
    }

    return res.json({
      ...result,
      customerId: matchedCustomer ? matchedCustomer._id : null,
      customer: matchedCustomer || null,
    });
  } catch (err) {
    console.error('[POST /api/tabs/parse] Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/tabs
 * Returns current tabs (open, alerting, khata, and recent paid/cancelled)
 */
router.get('/', async (req, res) => {
  try {
    const limit = Number(req.query.limit || 50);
    const tabs = await Tab.find()
      .populate('customerId')
      .sort({ createdAt: -1 })
      .limit(limit);
    const vendor = await Vendor.findOne();
    const activeAlertSeconds = await resolveAlertSecondsForNewTab(new Date());
    return res.json({
      tabs,
      vendor,
      currencySymbol: process.env.CURRENCY_SYMBOL || '₹',
      paypalCurrency: process.env.PAYPAL_CURRENCY || 'INR',
      alertSeconds: activeAlertSeconds,
    });
  } catch (err) {
    console.error('[GET /api/tabs] Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/tabs/:id
 * Public/Customer view for a single tab (used by /pay/:tabId and receipts).
 * Strips customer phone/personal data; returns stall name, order number, items, amount, status, and PayPal approval link.
 */
router.get('/:id', async (req, res) => {
  try {
    if (!/^[0-9a-fA-F]{24}$/.test(String(req.params.id))) {
      return res.status(400).json({ error: 'Invalid tab ID' });
    }
    const tab = await Tab.findById(req.params.id);
    if (!tab) {
      return res.status(404).json({ error: 'Order tab not found' });
    }
    const vendor = await Vendor.findOne();
    return res.json({
      tab: {
        _id: tab._id,
        number: tab.number,
        items: tab.items,
        amount: tab.amount,
        currency: tab.currency,
        status: tab.status,
        mode: tab.mode,
        paymentMethod: tab.paymentMethod,
        paypal: {
          orderId: tab.paypal?.orderId || null,
          approvalUrl: tab.paypal?.approvalUrl || null,
          captureId: tab.paypal?.captureId || null,
          paidAmount: tab.paypal?.paidAmount || 0,
        },
        createdAt: tab.createdAt,
        paidAt: tab.paidAt,
      },
      stallName: vendor?.name || 'Sharma Ji Chaat & Chai Stall',
      currencySymbol: process.env.CURRENCY_SYMBOL || '₹',
      devMode: process.env.DEV_MODE === 'true',
    });
  } catch (err) {
    console.error('[GET /api/tabs/:id] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/tabs
 * Creates a new tab (+ PayPal Sandbox order if mode === 'PAY_NOW')
 */
router.post('/', async (req, res) => {
  try {
    const parsed = CreateTabInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid tab payload',
        details: parsed.error.flatten(),
      });
    }

    const { items, amount, mode, customerId, customerName } = parsed.data;
    const lastTab = await Tab.findOne().sort({ number: -1 });
    const nextNumber = lastTab ? lastTab.number + 1 : 1;

    let resolvedCustomerId = customerId || null;
    if (!resolvedCustomerId && customerName) {
      let existingCustomer = await Customer.findOne({
        name: new RegExp(`^${customerName.trim()}$`, 'i'),
      });
      if (!existingCustomer) {
        existingCustomer = await Customer.create({
          name: customerName.trim(),
          phone: '+919876543299',
          whatsappConsent: true,
        });
      }
      resolvedCustomerId = existingCustomer._id;
    }

    const currency = process.env.PAYPAL_CURRENCY || 'INR';
    const initialStatus = mode === 'KHATA' ? 'KHATA' : 'OPEN';
    const alertAfterSeconds =
      mode === 'PAY_NOW'
        ? await resolveAlertSecondsForNewTab(new Date())
        : Number(process.env.ALERT_SECONDS || 30);

    const tab = await Tab.create({
      number: nextNumber,
      items,
      amount,
      currency,
      status: initialStatus,
      mode,
      customerId: resolvedCustomerId,
      alertAfterSeconds,
    });

    let approvalUrl = null;
    if (mode === 'PAY_NOW' && amount > 0) {
      const description = items.map((i) => `${i.qty}x ${i.name}`).join(', ');
      const ppOrder = await createPayPalOrder({
        tabId: tab._id,
        tabNumber: tab.number,
        amount: tab.amount,
        currency: tab.currency,
        description,
      });

      tab.paypal = {
        orderId: ppOrder.orderId,
        approvalUrl: ppOrder.approvalUrl,
        captureId: null,
        paidAmount: 0,
      };
      await tab.save();
      approvalUrl = ppOrder.approvalUrl;
    }

    const populatedTab = await Tab.findById(tab._id).populate('customerId');
    emitSocketEvent('tab:created', { tab: populatedTab, approvalUrl });
    await broadcastStatsUpdated();

    return res.status(201).json({
      tab: populatedTab,
      approvalUrl,
    });
  } catch (err) {
    console.error('[POST /api/tabs] Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/tabs/:id
 * Vendor corrections (items, amount, cancel, mark cash received).
 * Security Rule: Client can NEVER set status to PAID via arbitrary status field;
 * only verified PayPal webhooks or explicit cash-received fallback action can settle a tab.
 * If items/amount are corrected while QR is open, cancels the old PayPal order reference and creates a new PayPal order.
 */
router.patch('/:id', async (req, res) => {
  try {
    const parsed = PatchTabInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: 'Invalid patch payload',
        details: parsed.error.flatten(),
      });
    }

    const tab = await Tab.findById(req.params.id).populate('customerId');
    if (!tab) {
      return res.status(404).json({ error: 'Tab not found' });
    }

    const { items, amount, status, markCashReceived } = parsed.data;

    if (status === 'CANCELLED') {
      tab.status = 'CANCELLED';
      await tab.save();
      emitSocketEvent('tab:updated', { tab });
      await broadcastStatsUpdated();
      return res.json({ tab });
    }

    if (markCashReceived) {
      tab.status = 'PAID';
      tab.paymentMethod = 'CASH';
      tab.paidAt = new Date();
      await tab.save();
      const itemsSpoken =
        (tab.items || []).map((i) => `${i.qty} ${i.name}`).join(', ') || `Order ${tab.number}`;
      emitSocketEvent('tab:paid', {
        tab,
        spokenEn: `${itemsSpoken}, ${tab.amount} rupees cash received`,
        spokenHi: `${itemsSpoken} के ${tab.amount} रुपये कैश मिल गए`,
      });
      await broadcastStatsUpdated();
      return res.json({ tab });
    }

    if (items) {
      tab.items = items;
      tab.amount =
        amount !== undefined
          ? amount
          : items.reduce((sum, item) => sum + item.qty * item.unitPrice, 0);
    } else if (amount !== undefined) {
      tab.amount = amount;
    }

    // Edge case: Vendor corrects an order after QR is shown -> create a fresh PayPal order
    if (tab.mode === 'PAY_NOW' && ['OPEN', 'ALERTED'].includes(tab.status) && tab.amount > 0) {
      const description = tab.items.map((i) => `${i.qty}x ${i.name}`).join(', ');
      const ppOrder = await createPayPalOrder({
        tabId: tab._id,
        tabNumber: tab.number,
        amount: tab.amount,
        currency: tab.currency,
        description,
      });
      tab.paypal = {
        orderId: ppOrder.orderId,
        approvalUrl: ppOrder.approvalUrl,
        captureId: null,
        paidAmount: 0,
      };
    }

    await tab.save();
    emitSocketEvent('tab:updated', { tab });
    await broadcastStatsUpdated();
    return res.json({ tab, approvalUrl: tab.paypal?.approvalUrl });
  } catch (err) {
    console.error('[PATCH /api/tabs/:id] Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/tabs/:id/cash
 * Button fallback: vendor marks cash received
 */
router.post('/:id/cash', async (req, res) => {
  try {
    const tab = await Tab.findById(req.params.id).populate('customerId');
    if (!tab) {
      return res.status(404).json({ error: 'Tab not found' });
    }

    tab.status = 'PAID';
    tab.paymentMethod = 'CASH';
    tab.paidAt = new Date();
    await tab.save();

    const custId = tab.customerId?._id || tab.customerId;
    if (custId) {
      await markPromisesKeptIfSettled(custId);
    }

    const itemsSpoken =
      (tab.items || []).map((i) => `${i.qty} ${i.name}`).join(', ') || `Order ${tab.number}`;

    emitSocketEvent('tab:paid', {
      tab,
      spokenEn: `${itemsSpoken}, ${tab.amount} rupees cash received`,
      spokenHi: `${itemsSpoken} के ${tab.amount} रुपये कैश मिल गए`,
    });
    await broadcastStatsUpdated();

    return res.json({ tab });
  } catch (err) {
    console.error('[POST /api/tabs/:id/cash] Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/tabs/:id/refund
 * Refunds a captured PayPal order (Stretch: partial payments & refunds UI)
 */
router.post('/:id/refund', async (req, res) => {
  try {
    const tab = await Tab.findById(req.params.id).populate('customerId');
    if (!tab) {
      return res.status(404).json({ error: 'Tab not found' });
    }
    if (!tab.paypal?.captureId) {
      return res.status(400).json({ error: 'No PayPal capture ID available to refund' });
    }

    const refundRes = await refundPayPalCapture(tab.paypal.captureId, {
      amount: req.body?.amount || tab.amount,
      currency: tab.currency,
      note: req.body?.note || `Refund for Order #${tab.number}`,
    });

    tab.status = 'REFUNDED';
    await tab.save();

    const itemsSpoken =
      (tab.items || []).map((i) => `${i.qty} ${i.name}`).join(', ') || `Order ${tab.number}`;

    emitSocketEvent('tab:updated', {
      tab,
      spokenEn: `${itemsSpoken}, ${tab.amount} rupees refunded`,
      spokenHi: `${itemsSpoken} के ${tab.amount} रुपये रिफंड कर दिए गए`,
    });
    await broadcastStatsUpdated();

    return res.json({ tab, refund: refundRes });
  } catch (err) {
    console.error('[POST /api/tabs/:id/refund] Error:', err);
    return res.status(500).json({ error: err.message });
  }
});

export default router;

