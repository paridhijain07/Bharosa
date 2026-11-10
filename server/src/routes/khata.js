import express from 'express';
import { Tab, Customer, Reminder, Vendor, CustomerPromise } from '../models/index.js';
import { createPayPalOrder } from '../services/paypal.js';
import {
  generateCollectorReminder,
  buildSpokenKhataSummary,
  buildSafeAutoReplyTemplate,
} from '../services/llm.js';
import { sendGuardedCollectorMessage } from '../services/collector.js';
import { emitSocketEvent } from '../sockets.js';
import { broadcastStatsUpdated } from './stats.js';

const router = express.Router();

/**
 * POST /api/khata/:tabId/remind
 * Triggers the Collector agent for a KHATA tab:
 * 1. Verifies customer consent, dispute status, and active promises
 * 2. Creates a PayPal order for the outstanding balance & extracts its approvalUrl payLink
 * 3. Runs the Collector AI + Hard Guardrails + Outbound Send Limits / Quiet Hours
 * 4. Sends WhatsApp message via Twilio and records both Reminder & outbound Message in the thread
 */
router.post('/:tabId/remind', async (req, res) => {
  try {
    const tab = await Tab.findById(req.params.tabId).populate('customerId');
    if (!tab) {
      return res.status(404).json({ error: 'Khata tab not found' });
    }

    let customer = tab.customerId;
    if (!customer) {
      customer = await Customer.findOne({ whatsappConsent: true });
    }
    if (!customer) {
      return res.status(400).json({ error: 'No customer linked to this Khata tab' });
    }

    if (!customer.whatsappConsent) {
      return res.status(403).json({
        error: `${customer.name} has not granted WhatsApp reminder consent (whatsappConsent = false).`,
      });
    }

    if (tab.disputed || customer.collectorStatus === 'DISPUTED') {
      return res.status(400).json({
        error: `Reminders stopped: ${customer.name} has disputed this order.`,
      });
    }

    // Check if customer has an active PENDING promise in the future
    const activePromise = await CustomerPromise.findOne({
      customerId: customer._id,
      status: 'PENDING',
      dueDate: { $gt: new Date() },
    });
    if (activePromise && !req.body?.forceRemind) {
      return res.status(200).json({
        sent: false,
        suppressedByPromise: true,
        promise: activePromise,
        reason: `Reminders paused until promised date (${activePromise.dueDateStr || activePromise.dueDate.toISOString().slice(0, 10)})`,
      });
    }

    const previousReminders = await Reminder.countDocuments({
      customerId: customer._id,
      status: 'SENT',
    });
    const attempt = previousReminders + 1;

    // Ensure there is a PayPal order payLink for this Khata tab
    const unpaidTabAmt = Math.max(0, Number(tab.amount) - Number(tab.paypal?.paidAmount || 0));
    let payLink = tab.paypal?.approvalUrl;
    if (!payLink) {
      const description = (tab.items || []).map((i) => `${i.qty}x ${i.name}`).join(', ');
      const ppOrder = await createPayPalOrder({
        tabId: tab._id,
        tabNumber: tab.number,
        amount: unpaidTabAmt || tab.amount,
        currency: tab.currency || process.env.PAYPAL_CURRENCY || 'INR',
        description: `Khata Balance (${customer.name}): ${description}`,
      });
      tab.paypal = {
        orderId: ppOrder.orderId,
        approvalUrl: ppOrder.approvalUrl,
        captureId: null,
        paidAmount: tab.paypal?.paidAmount || 0,
      };
      await tab.save();
      payLink = ppOrder.approvalUrl;
    }

    const vendor = await Vendor.findOne();
    const language = req.body?.language || vendor?.language || 'hi';
    const currencySymbol = process.env.CURRENCY_SYMBOL || '₹';
    const daysSinceCredit = Math.max(
      1,
      Math.round((Date.now() - new Date(tab.createdAt).getTime()) / (1000 * 60 * 60 * 24))
    );

    const decision = await generateCollectorReminder({
      customer,
      tab,
      attempt,
      daysSinceCredit,
      payLink,
      language,
      currencySymbol,
    });

    if (!decision.send) {
      return res.status(200).json({
        sent: false,
        reason: decision.message,
      });
    }

    // Send via Guardrails + Outbound Send Policy (creates outbound Message doc automatically)
    const sendRes = await sendGuardedCollectorMessage({
      customer,
      body: decision.message,
      allowedAmounts: [tab.amount, unpaidTabAmt],
      fallbackTemplateArgs: {
        action: 'PAYING_NOW',
        customerName: customer.name,
        language,
        amount: unpaidTabAmt || tab.amount,
        payLink,
        currencySymbol,
      },
      isReminder: true,
      ignoreQuietHours: process.env.DEV_MODE === 'true' && Boolean(req.body?.ignoreQuietHours ?? true),
    });

    if (!sendRes.sent) {
      return res.status(200).json({
        sent: false,
        queuedForMorning: Boolean(sendRes.queuedForMorning),
        blockedByPolicy: Boolean(sendRes.blockedByPolicy),
        reason: sendRes.reason || sendRes.error || 'Blocked by outbound policy',
      });
    }

    const reminder = await Reminder.create({
      tabId: tab._id,
      customerId: customer._id,
      attempt,
      tone: decision.tone,
      channel: 'whatsapp',
      payLink,
      message: sendRes.body || decision.message,
      status: 'SENT',
      error: null,
    });

    // Compute total outstanding for this customer across all open KHATA tabs
    const allOpenKhataForCustomer = await Tab.find({
      customerId: customer._id,
      status: { $in: ['KHATA', 'PARTIAL'] },
    });
    const totalOwed =
      allOpenKhataForCustomer.reduce(
        (sum, t) => sum + Math.max(0, Number(t.amount) - Number(t.paypal?.paidAmount || 0)),
        0
      ) || tab.amount;

    const spokenEn = buildSpokenKhataSummary({
      customerName: customer.name,
      amount: totalOwed,
      reminderCount: attempt,
      language: 'en',
    });
    const spokenHi = buildSpokenKhataSummary({
      customerName: customer.name,
      amount: totalOwed,
      reminderCount: attempt,
      language: 'hi',
    });

    const socketPayload = {
      reminder,
      tab,
      customer,
      spokenEn,
      spokenHi,
      whatsappSimulated: sendRes.simulated || false,
    };

    emitSocketEvent('reminder:sent', socketPayload);
    emitSocketEvent('summary:speak', { spokenEn, spokenHi });

    return res.json({
      sent: true,
      reminder,
      payLink,
      spokenEn,
      spokenHi,
      whatsappSimulated: sendRes.simulated || false,
    });
  } catch (err) {
    console.error('[POST /api/khata/:tabId/remind] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/khata/customer/:customerId/template-reply
 * One-tap "Send template reply" action from the "Needs you" list in KhataView.
 * Sends a polite, guardrail-validated template with the PayPal link and clears NEEDS_VENDOR/DISPUTED.
 */
router.post('/customer/:customerId/template-reply', async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.customerId);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    const openTabs = await Tab.find({
      customerId: customer._id,
      status: { $in: ['KHATA', 'PARTIAL'] },
    }).sort({ createdAt: 1 });

    const totalOwed = openTabs.reduce(
      (s, t) => s + Math.max(0, Number(t.amount) - Number(t.paypal?.paidAmount || 0)),
      0
    );
    const primaryTab = openTabs[0] || null;
    let payLink = primaryTab?.paypal?.approvalUrl || `${process.env.PUBLIC_BASE_URL || 'http://localhost:4000'}`;

    if (primaryTab && !primaryTab.paypal?.approvalUrl && totalOwed > 0) {
      const ppOrder = await createPayPalOrder({
        tabId: primaryTab._id,
        tabNumber: primaryTab.number,
        amount: totalOwed,
        currency: primaryTab.currency || process.env.PAYPAL_CURRENCY || 'INR',
        description: `Khata Balance (${customer.name})`,
      });
      primaryTab.paypal = {
        orderId: ppOrder.orderId,
        approvalUrl: ppOrder.approvalUrl,
        captureId: null,
        paidAmount: primaryTab.paypal?.paidAmount || 0,
      };
      await primaryTab.save();
      payLink = ppOrder.approvalUrl;
    }

    // Clear dispute/needs_vendor flag when vendor sends template reply
    for (const t of openTabs) {
      if (t.disputed) {
        t.disputed = false;
        await t.save();
      }
    }
    customer.collectorStatus = 'NONE';
    customer.collectorNote = 'Template reply sent by vendor';
    await customer.save();

    const language = req.body?.language || 'hi';
    const currencySymbol = process.env.CURRENCY_SYMBOL || '₹';
    const templateArgs = {
      action: 'PAYING_NOW',
      customerName: customer.name,
      language,
      amount: totalOwed,
      payLink,
      currencySymbol,
    };
    const body = buildSafeAutoReplyTemplate(templateArgs);

    const sendRes = await sendGuardedCollectorMessage({
      customer,
      body,
      allowedAmounts: [totalOwed],
      fallbackTemplateArgs: templateArgs,
      ignoreQuietHours: true,
    });

    await broadcastStatsUpdated();
    return res.json({
      ok: true,
      sent: sendRes.sent,
      message: sendRes.messageDoc || null,
      customer,
    });
  } catch (err) {
    console.error('[POST /api/khata/customer/:customerId/template-reply] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
