import { Tab, WebhookEvent } from '../models/index.js';
import { emitSocketEvent } from '../sockets.js';
import { broadcastStatsUpdated } from '../routes/stats.js';
import { markPromisesKeptIfSettled } from './collector.js';

/**
 * Shared internal handler that marks a tab as PAID (or PARTIAL) upon verified payment capture.
 * Used ONLY by:
 * 1. Verified PayPal Webhook (`PAYMENT.CAPTURE.COMPLETED` / `CHECKOUT.ORDER.APPROVED` capture)
 * 2. Server-side PayPal return capture
 * 3. `POST /api/dev/simulate-payment/:tabId` (when `DEV_MODE=true`)
 */
export async function applyVerifiedPayment({
  tabId,
  orderId,
  captureId,
  paidAmount,
  currency,
  eventId,
  eventType = 'PAYMENT.CAPTURE.COMPLETED',
}) {
  // 1. Idempotency check if eventId is provided
  if (eventId) {
    const existing = await WebhookEvent.findOne({ eventId });
    if (existing) {
      return { duplicate: true, eventId };
    }
  }

  // 2. Locate the target tab by custom_id (tabId) or paypal.orderId
  let tab = null;
  if (tabId && /^[0-9a-fA-F]{24}$/.test(String(tabId))) {
    tab = await Tab.findById(tabId).populate('customerId');
  }
  if (!tab && orderId) {
    tab = await Tab.findOne({ 'paypal.orderId': orderId }).populate('customerId');
  }

  // Stretch 7.4 Reconciler: if payment arrived without matching reference/orderId, match by amount
  if (!tab && paidAmount !== undefined && paidAmount !== null) {
    const openCandidates = await Tab.find({
      status: { $in: ['OPEN', 'ALERTED'] },
      amount: Number(paidAmount),
    }).populate('customerId');

    if (openCandidates.length === 1) {
      tab = openCandidates[0];
    } else if (openCandidates.length > 1) {
      const candidateNumbers = openCandidates.map((c) => c.number);
      emitSocketEvent('reconcile:prompt', {
        amount: Number(paidAmount),
        captureId,
        candidates: openCandidates.map((c) => ({ _id: c._id, number: c.number, items: c.items })),
        questionEn: `Received ${paidAmount} rupees. Was this for Order ${candidateNumbers.join(' or Order ')}?`,
        questionHi: `${paidAmount} रुपये मिले। क्या यह ऑर्डर ${candidateNumbers.join(' या ऑर्डर ')} के लिए था?`,
      });
      if (eventId) {
        await WebhookEvent.create({ eventId, type: eventType });
      }
      return { reconciled: false, ambiguous: true, candidates: candidateNumbers };
    }
  }

  if (!tab) {
    return { notFound: true };
  }

  // Record idempotency event after finding tab (so if webhook arrived before tab finished creating, PayPal can retry or we handle it)
  if (eventId) {
    try {
      await WebhookEvent.create({ eventId, type: eventType });
    } catch (err) {
      if (err.code === 11000) {
        return { duplicate: true, eventId };
      }
      throw err;
    }
  }

  // Already paid idempotency guard
  if (tab.status === 'PAID') {
    return { duplicate: false, alreadyPaid: true, tab };
  }

  // Validate currency if provided
  const expectedCurrency = (tab.currency || process.env.PAYPAL_CURRENCY || 'INR').toUpperCase();
  if (currency && currency.toUpperCase() !== expectedCurrency) {
    throw new Error(`Currency mismatch: expected ${expectedCurrency}, got ${currency}`);
  }

  const numericPaid =
    paidAmount !== undefined && paidAmount !== null ? Number(paidAmount) : Number(tab.amount);
  const cumulativePaid = Number((tab.paypal?.paidAmount || 0) + numericPaid);

  // Check for underpayment (PARTIAL) vs full payment (PAID)
  const isFullPayment = cumulativePaid + 0.009 >= tab.amount;
  tab.status = isFullPayment ? 'PAID' : 'PARTIAL';
  tab.paymentMethod = 'PAYPAL';
  tab.paidAt = isFullPayment ? new Date() : tab.paidAt;
  tab.paypal = {
    ...(tab.paypal ? tab.paypal.toObject?.() || tab.paypal : {}),
    orderId: orderId || tab.paypal?.orderId || null,
    captureId: captureId || `CAP-${Date.now().toString(36).toUpperCase()}`,
    paidAmount: cumulativePaid,
  };

  await tab.save();

  const itemsSpoken =
    (tab.items || []).map((i) => `${i.qty} ${i.name}`).join(', ') || `Order ${tab.number}`;

  const eventPayload = {
    tab,
    spokenEn:
      tab.status === 'PAID'
        ? `${itemsSpoken}, ${tab.amount} rupees received`
        : `${itemsSpoken} partially paid, ${cumulativePaid} of ${tab.amount} rupees received`,
    spokenHi:
      tab.status === 'PAID'
        ? `${itemsSpoken} के ${tab.amount} रुपये मिल गए`
        : `${itemsSpoken} का अधूरा पेमेंट मिला, ${cumulativePaid} रुपये`,
  };

  if (tab.status === 'PAID') {
    const custId = tab.customerId?._id || tab.customerId;
    if (custId) {
      await markPromisesKeptIfSettled(custId);
    }
    emitSocketEvent('tab:paid', eventPayload);
  } else {
    emitSocketEvent('tab:updated', eventPayload);
  }

  await broadcastStatsUpdated();

  return { duplicate: false, tab };
}

