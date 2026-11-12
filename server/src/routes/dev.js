import express from 'express';
import { z } from 'zod';
import { Tab } from '../models/index.js';
import { applyVerifiedPayment } from '../services/paymentProcessor.js';
import { processInboundCustomerMessage } from '../services/collector.js';
import { resetPitchState, cleanSlateForRecording } from '../services/seed.js';

const router = express.Router();

const DevInboundSchema = z.object({
  phone: z.string().min(5),
  text: z.string().min(1),
  messageSid: z.string().optional(),
  todayDateStr: z.string().optional(),
  ignoreQuietHours: z.boolean().optional(),
  ignoreRateLimits: z.boolean().optional(),
});

/**
 * POST /api/dev/simulate-payment/:tabId
 * ONLY enabled when DEV_MODE=true.
 * Runs the exact same internal "mark paid" path (`applyVerifiedPayment`) as a verified PayPal webhook.
 */
router.post('/simulate-payment/:tabId', async (req, res) => {
  if (process.env.DEV_MODE !== 'true') {
    return res.status(403).json({
      error: 'Forbidden: /api/dev/simulate-payment is only available when DEV_MODE=true',
    });
  }

  try {
    const tab = await Tab.findById(req.params.tabId);
    if (!tab) {
      return res.status(404).json({ error: 'Tab not found' });
    }

    const paidAmount =
      req.body?.amount !== undefined ? Number(req.body.amount) : Number(tab.amount);
    const currency = req.body?.currency || tab.currency || process.env.PAYPAL_CURRENCY || 'INR';
    const eventId = req.body?.eventId || `SIM-WH-${tab._id}-${Date.now()}`;

    const result = await applyVerifiedPayment({
      tabId: tab._id,
      orderId: tab.paypal?.orderId || `SIM-ORD-${tab.number}`,
      captureId: `SIM-CAP-${Date.now().toString(36).toUpperCase()}`,
      paidAmount,
      currency,
      eventId,
      eventType: 'PAYMENT.CAPTURE.COMPLETED',
    });

    return res.json({
      simulated: true,
      ...result,
    });
  } catch (err) {
    console.error('[POST /api/dev/simulate-payment/:tabId] Error:', err.message);
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/dev/whatsapp-inbound
 * ONLY enabled when DEV_MODE=true.
 * Accepts `{ phone, text }` and runs the exact same two-way WhatsApp collector pipeline
 * (`processInboundCustomerMessage`) as `POST /api/whatsapp/inbound`.
 */
router.post('/whatsapp-inbound', async (req, res) => {
  if (process.env.DEV_MODE !== 'true') {
    return res.status(403).json({
      error: 'Forbidden: /api/dev/whatsapp-inbound is only available when DEV_MODE=true',
    });
  }

  const parsed = DevInboundSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Invalid payload: phone and text are required',
      details: parsed.error.flatten(),
    });
  }

  try {
    const result = await processInboundCustomerMessage({
      fromPhone: parsed.data.phone,
      body: parsed.data.text,
      messageSid: parsed.data.messageSid || null,
      todayDateStr: parsed.data.todayDateStr || null,
      ignoreQuietHours:
        parsed.data.ignoreQuietHours !== undefined ? parsed.data.ignoreQuietHours : true,
      ignoreRateLimits:
        parsed.data.ignoreRateLimits !== undefined ? parsed.data.ignoreRateLimits : true,
    });

    return res.json({
      simulated: true,
      ...result,
    });
  } catch (err) {
    console.error('[POST /api/dev/whatsapp-inbound] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/dev/pitch-reset
 * Resets the active orders & Raju's WhatsApp thread to a clean 90-second Judge Pitch state.
 */
router.post('/pitch-reset', async (req, res) => {
  try {
    const info = await resetPitchState();
    return res.json({
      ok: true,
      ...info,
      spokenEn: 'Workspace ready.',
      spokenHi: 'नया शिफ्ट डेटा तैयार है।',
    });
  } catch (err) {
    console.error('[POST /api/dev/pitch-reset] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/dev/clean-slate
 * Wipes all pre-seeded/old orders, messages, and reminders so the stall starts at ₹0 (Order #1).
 */
router.post('/clean-slate', async (req, res) => {
  try {
    const info = await cleanSlateForRecording();
    return res.json({
      ok: true,
      ...info,
      spokenEn: 'New shift started. Ready for your first order!',
      spokenHi: 'नया दिन शुरू! पहला ऑर्डर बोलकर या टैप कर बनाएं।',
    });
  } catch (err) {
    console.error('[POST /api/dev/clean-slate] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
