import express from 'express';
import { verifyTwilioWebhookSignature } from '../services/whatsapp.js';
import { processInboundCustomerMessage } from '../services/collector.js';

const router = express.Router();

// Twilio sends application/x-www-form-urlencoded payloads
router.use(express.urlencoded({ extended: false }));

/**
 * POST /api/whatsapp/inbound
 * Twilio WhatsApp Sandbox Inbound Webhook:
 * 1. Verifies `X-Twilio-Signature` against `PUBLIC_BASE_URL + req.originalUrl` and form params.
 *    Rejects invalid signatures with 403 (in DEV_MODE only, allows `x-dev-bypass-signature: true`).
 * 2. Responds quickly with an empty TwiML `<Response></Response>` 200 OK.
 * 3. Runs `processInboundCustomerMessage` (idempotent on `MessageSid`, ignores unknown numbers).
 */
router.post('/inbound', async (req, res) => {
  const signatureHeader = req.headers['x-twilio-signature'] || '';
  const devBypass =
    process.env.DEV_MODE === 'true' &&
    (req.headers['x-dev-bypass-signature'] === 'true' || req.body?.devBypass === 'true');

  const publicBase = (
    process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`
  ).replace(/\/$/, '');
  const fullWebhookUrl = `${publicBase}${req.originalUrl}`;

  const isSignatureValid = verifyTwilioWebhookSignature({
    authToken: process.env.TWILIO_AUTH_TOKEN,
    signatureHeader,
    url: fullWebhookUrl,
    params: req.body || {},
    devBypass,
  });

  if (!isSignatureValid) {
    return res.status(403).json({
      error: 'Forbidden: Invalid X-Twilio-Signature',
    });
  }

  const fromPhone = req.body?.From || '';
  const body = req.body?.Body || '';
  const messageSid = req.body?.MessageSid || req.body?.SmsMessageSid || null;

  // Send empty TwiML 200 immediately so Twilio never times out
  res.status(200).type('text/xml').send('<Response></Response>');

  // Process asynchronously
  processInboundCustomerMessage({
    fromPhone,
    body,
    messageSid,
  }).catch((err) => {
    console.error('[POST /api/whatsapp/inbound] Async error:', err.message);
  });
});

export default router;

