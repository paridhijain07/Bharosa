import express from 'express';
import { Tab } from '../models/index.js';
import { capturePayPalOrder, verifyPayPalWebhookSignature } from '../services/paypal.js';
import { applyVerifiedPayment } from '../services/paymentProcessor.js';

const router = express.Router();

/**
 * POST /api/paypal/webhook
 * Verified, idempotent PayPal webhook handler.
 * Handles:
 * - CHECKOUT.ORDER.APPROVED -> captures the order server-side
 * - PAYMENT.CAPTURE.COMPLETED -> verifies signature, checks amount & currency, marks tab PAID, emits tab:paid
 */
router.post('/webhook', async (req, res) => {
  try {
    const event = req.body;
    if (!event || !event.id || !event.event_type) {
      return res.status(400).json({ error: 'Malformed webhook event payload' });
    }

    // 1. Verify webhook signature with PayPal API
    const isValidSignature = await verifyPayPalWebhookSignature({
      headers: req.headers,
      eventBody: event,
    });

    if (!isValidSignature) {
      console.warn(`[PayPal Webhook] Signature verification failed for event ${event.id}`);
      return res.status(401).json({ error: 'Invalid PayPal webhook signature' });
    }

    const eventId = event.id;
    const eventType = event.event_type;
    const resource = event.resource || {};

    // 2. Handle CHECKOUT.ORDER.APPROVED -> trigger server-side capture
    if (eventType === 'CHECKOUT.ORDER.APPROVED') {
      const orderId = resource.id;
      const purchaseUnit = (resource.purchase_units || [])[0] || {};
      const customId = purchaseUnit.custom_id;

      const captureResult = await capturePayPalOrder(orderId);
      if (captureResult.status === 'COMPLETED') {
        const result = await applyVerifiedPayment({
          tabId: customId || captureResult.customId,
          orderId,
          captureId: captureResult.captureId,
          paidAmount: captureResult.amount,
          currency: captureResult.currency,
          eventId,
          eventType,
        });
        return res.status(200).json({ status: 'CAPTURED_AND_PROCESSED', ...result });
      }
      return res.status(200).json({ status: 'APPROVED_PENDING_CAPTURE', orderId });
    }

    // 3. Handle PAYMENT.CAPTURE.COMPLETED -> mark tab PAID
    if (eventType === 'PAYMENT.CAPTURE.COMPLETED') {
      const captureId = resource.id;
      const orderId = resource?.supplementary_data?.related_ids?.order_id || null;
      const customId = resource.custom_id || null;
      const paidAmount = resource.amount ? Number(resource.amount.value) : null;
      const currency = resource.amount ? resource.amount.currency_code : null;

      const result = await applyVerifiedPayment({
        tabId: customId,
        orderId,
        captureId,
        paidAmount,
        currency,
        eventId,
        eventType,
      });

      if (result.notFound) {
        // Edge case: Webhook arrives before client finishes creating tab -> return 202 or 404 so PayPal can retry if needed
        return res.status(202).json({ status: 'TAB_NOT_FOUND_YET', orderId, customId });
      }

      return res.status(200).json({ status: 'OK', ...result });
    }

    return res.status(200).json({ status: 'IGNORED_EVENT_TYPE', eventType });
  } catch (err) {
    console.error('[POST /api/paypal/webhook] Error:', err.message);
    return res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/paypal/return
 * Return URL after buyer approves on PayPal Sandbox.
 * Captures the order server-side and marks the tab PAID.
 */
router.get('/return', async (req, res) => {
  try {
    const { token: orderId, tabId } = req.query;
    if (!orderId) {
      return res.status(400).send('Missing PayPal order token');
    }

    const captureResult = await capturePayPalOrder(orderId);
    const verified = await applyVerifiedPayment({
      tabId: tabId || captureResult.customId,
      orderId,
      captureId: captureResult.captureId,
      paidAmount: captureResult.amount,
      currency: captureResult.currency,
      eventId: `RETURN-CAPTURE-${orderId}`,
      eventType: 'CHECKOUT.ORDER.APPROVED',
    });

    const resolvedTabId = tabId || verified?.tab?._id;
    if (resolvedTabId) {
      return res.redirect(`/pay/${resolvedTabId}?paid=1`);
    }

    return res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Payment Complete — Bharosa</title>
        <style>
          body { font-family: system-ui, sans-serif; background: #064e3b; color: #fff; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; text-align: center; padding: 20px; }
          .card { background: #047857; padding: 32px; border-radius: 20px; max-width: 400px; box-shadow: 0 10px 30px rgba(0,0,0,0.4); }
          h1 { font-size: 2.2rem; margin: 0 0 12px; }
          p { font-size: 1.2rem; opacity: 0.9; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>✅ Paid!</h1>
          <p>Your PayPal payment is confirmed. The stall vendor has been notified aloud.</p>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('[GET /api/paypal/return] Error:', err.message);
    return res.status(500).send(`Payment capture error: ${err.message}`);
  }
});

/**
 * GET /api/paypal/sandbox-checkout/:tabId
 * Interactive Sandbox Buyer Approval screen when running in local DEV_MODE without live API keys,
 * or for quick 1-tap QR scan demos on a phone. Submits a signed webhook to POST /api/paypal/webhook.
 */
router.get('/sandbox-checkout/:tabId', async (req, res) => {
  try {
    const tab = await Tab.findById(req.params.tabId).populate('customerId');
    if (!tab) {
      return res.status(404).send('Order Tab not found');
    }

    const itemsHtml = (tab.items || [])
      .map((i) => `<li>${i.qty} × ${i.name} — ₹${i.qty * i.unitPrice}</li>`)
      .join('');

    return res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>PayPal Sandbox Checkout — Order #${tab.number}</title>
        <style>
          body { font-family: system-ui, -apple-system, sans-serif; background: #f3f4f6; color: #111827; margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; padding: 16px; box-sizing: border-box; }
          .box { background: #fff; border-radius: 20px; padding: 28px; width: 100%; max-width: 400px; box-shadow: 0 12px 32px rgba(0,0,0,0.12); text-align: center; }
          .pp-logo { color: #003087; font-weight: 900; font-size: 1.8rem; letter-spacing: -0.5px; margin-bottom: 6px; }
          .pp-logo span { color: #0079C1; }
          .badge { display: inline-block; background: #fef3c7; color: #92400e; font-size: 0.75rem; font-weight: 700; padding: 4px 10px; border-radius: 99px; margin-bottom: 16px; }
          .order-num { font-size: 1.4rem; font-weight: 800; margin: 4px 0; }
          .amount { font-size: 2.6rem; font-weight: 900; color: #111827; margin: 12px 0; }
          ul { list-style: none; padding: 12px 16px; background: #f9fafb; border-radius: 12px; text-align: left; margin: 16px 0; }
          li { padding: 6px 0; font-size: 1rem; border-bottom: 1px solid #e5e7eb; }
          li:last-child { border-bottom: none; }
          button { width: 100%; background: #ffc439; color: #111827; border: none; padding: 18px; border-radius: 99px; font-size: 1.2rem; font-weight: 800; cursor: pointer; box-shadow: 0 4px 12px rgba(255,196,57,0.4); transition: transform 0.1s; }
          button:active { transform: scale(0.98); }
          .done { display: none; background: #059669; color: white; padding: 20px; border-radius: 14px; font-weight: 700; font-size: 1.2rem; margin-top: 16px; }
        </style>
      </head>
      <body>
        <div class="box">
          <div class="pp-logo">Pay<span>Pal</span></div>
          <div class="badge">SANDBOX CHECKOUT</div>
          <div class="order-num">Sharma Ji Stall • Order #${tab.number}</div>
          <div class="amount">₹${tab.amount} <small style="font-size:1rem;color:#6b7280;">(${tab.amount}.00 ${tab.currency})</small></div>
          <ul>${itemsHtml}</ul>
          <button id="payBtn" onclick="approvePay()">Approve & Pay Now</button>
          <div id="doneMsg" class="done">✅ Payment Sent! Check Vendor Screen.</div>
        </div>
        <script>
          async function approvePay() {
            const btn = document.getElementById('payBtn');
            btn.disabled = true;
            btn.innerText = 'Processing PayPal Capture...';
            const res = await fetch('/api/paypal/webhook', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'x-dev-webhook': 'true',
                'paypal-transmission-sig': 'SANDBOX_SIMULATED_SIG'
              },
              body: JSON.stringify({
                id: 'WH-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
                event_type: 'PAYMENT.CAPTURE.COMPLETED',
                resource: {
                  id: 'CAP-' + Date.now(),
                  custom_id: '${tab._id}',
                  amount: {
                    currency_code: '${tab.currency}',
                    value: '${Number(tab.amount).toFixed(2)}'
                  },
                  supplementary_data: {
                    related_ids: {
                      order_id: '${tab.paypal?.orderId || ''}'
                    }
                  }
                }
              })
            });
            if (res.ok) {
              window.location.href = '/pay/${tab._id}?paid=1';
            } else {
              btn.disabled = false;
              btn.innerText = 'Retry Payment';
            }
          }
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    return res.status(500).send(err.message);
  }
});

export default router;

