import crypto from 'crypto';
import { Message, Reminder } from '../models/index.js';

function isTwilioConfigured() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  return Boolean(sid) && Boolean(token) && sid.startsWith('AC') && !token.startsWith('your_');
}

/**
 * Redact phone number for safe logging (never log full phone numbers).
 * Example: "+919876543210" -> "+91******3210"
 */
export function redactPhone(phone) {
  const clean = String(phone || '').replace(/^whatsapp:/i, '').trim();
  if (clean.length <= 6) return '***';
  return `${clean.slice(0, 3)}******${clean.slice(-4)}`;
}

/**
 * Normalize Twilio `From` header ("whatsapp:+919876543210" -> "+919876543210")
 */
export function normalizeWhatsAppPhone(rawFrom) {
  return String(rawFrom || '')
    .replace(/^whatsapp:/i, '')
    .trim();
}

/**
 * Part 1.2: Verify Twilio `X-Twilio-Signature` header (HMAC-SHA1 of URL + sorted POST form params).
 */
export function computeTwilioSignature(authToken, url, params = {}) {
  const sortedKeys = Object.keys(params || {}).sort();
  let data = String(url || '');
  for (const key of sortedKeys) {
    data += key + String(params[key] ?? '');
  }
  return crypto.createHmac('sha1', String(authToken || '')).update(data, 'utf8').digest('base64');
}

export function verifyTwilioWebhookSignature({
  authToken = process.env.TWILIO_AUTH_TOKEN,
  signatureHeader,
  url,
  params = {},
  devBypass = false,
}) {
  if (devBypass && process.env.DEV_MODE === 'true') {
    return true;
  }
  if (!authToken || !signatureHeader || !url) {
    return false;
  }

  const expected = computeTwilioSignature(authToken, url, params);
  const sigBuf = Buffer.from(String(signatureHeader), 'utf8');
  const expBuf = Buffer.from(expected, 'utf8');
  if (sigBuf.length !== expBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

/**
 * Part 1.5: Check if a given Date falls inside Quiet Hours (21:00 to 08:00 IST by default).
 */
export function isQuietHoursIST(dateObj = new Date()) {
  const quietStart = Number(process.env.QUIET_HOURS_START ?? 21);
  const quietEnd = Number(process.env.QUIET_HOURS_END ?? 8);

  // Convert to Asia/Kolkata hour (0..23)
  const istHourStr = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    hour: 'numeric',
    hour12: false,
  }).format(new Date(dateObj));
  const istHour = Number(istHourStr) % 24;

  if (quietStart > quietEnd) {
    // Overnight window, e.g. 21:00 to 08:00
    return istHour >= quietStart || istHour < quietEnd;
  }
  return istHour >= quietStart && istHour < quietEnd;
}

/**
 * Part 1.5: Outbound Send Limits, Consent & Quiet Hours Guard.
 * - Requires `customer.whatsappConsent === true` (unless `isOptOutConfirmation === true`)
 * - Max `MAX_DAILY_OUTBOUND` (default 2) outbound messages per customer per day
 * - Max `MAX_WEEKLY_OUTBOUND` (default 4) outbound messages per customer per week
 * - Max `MAX_REMINDERS` (default 4) total reminders before handing over to vendor
 * - Quiet hours (21:00–08:00 IST): queues message for morning instead of sending immediately
 */
export async function checkOutboundSendPolicy({
  customer,
  now = new Date(),
  isOptOutConfirmation = false,
  isReminder = false,
  ignoreQuietHours = false,
  ignoreRateLimits = false,
}) {
  if (!customer || !customer.phone || !/^\+[1-9]\d{6,14}$/.test(customer.phone)) {
    return { allowed: false, reason: 'Invalid or missing customer phone number' };
  }

  if (ignoreRateLimits) {
    return { allowed: true, dailyOutCount: 0, weeklyOutCount: 0 };
  }

  if (!isOptOutConfirmation && !customer.whatsappConsent) {
    return { allowed: false, reason: 'Customer has not granted WhatsApp consent' };
  }

  const maxDaily = Number(process.env.MAX_DAILY_OUTBOUND ?? 2);
  const maxWeekly = Number(process.env.MAX_WEEKLY_OUTBOUND ?? 4);
  const maxReminders = Number(process.env.MAX_REMINDERS ?? 4);

  const nowMs = new Date(now).getTime();
  const oneDayAgo = new Date(nowMs - 24 * 3600 * 1000);
  const oneWeekAgo = new Date(nowMs - 7 * 24 * 3600 * 1000);

  if (isReminder) {
    const totalReminders = await Reminder.countDocuments({
      customerId: customer._id,
      status: 'SENT',
    });
    if (totalReminders >= maxReminders) {
      return {
        allowed: false,
        handoverToVendor: true,
        reason: `Reached MAX_REMINDERS (${maxReminders}) — handing over to vendor`,
      };
    }
  }

  const [dailyOutCount, weeklyOutCount] = await Promise.all([
    Message.countDocuments({
      customerId: customer._id,
      direction: 'OUT',
      queuedForMorning: false,
      createdAt: { $gte: oneDayAgo },
    }),
    Message.countDocuments({
      customerId: customer._id,
      direction: 'OUT',
      queuedForMorning: false,
      createdAt: { $gte: oneWeekAgo },
    }),
  ]);

  if (dailyOutCount >= maxDaily) {
    return {
      allowed: false,
      limitExceeded: 'daily',
      reason: `Daily outbound limit reached (${dailyOutCount}/${maxDaily})`,
    };
  }

  if (weeklyOutCount >= maxWeekly) {
    return {
      allowed: false,
      limitExceeded: 'weekly',
      reason: `Weekly outbound limit reached (${weeklyOutCount}/${maxWeekly})`,
    };
  }

  if (!ignoreQuietHours && isQuietHoursIST(now)) {
    return {
      allowed: false,
      queuedForMorning: true,
      reason: 'Quiet hours (21:00–08:00 IST) — queued for morning',
    };
  }

  return {
    allowed: true,
    dailyOutCount,
    weeklyOutCount,
  };
}

/**
 * Send a WhatsApp message via Twilio WhatsApp Sandbox API.
 * Never logs full phone numbers. Retries once on transient failure.
 */
export async function sendWhatsAppReminder({ toPhone, body }) {
  const from = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
  const cleanPhone = normalizeWhatsAppPhone(toPhone);
  const formattedTo = `whatsapp:${cleanPhone}`;
  const redacted = redactPhone(cleanPhone);

  if (!isTwilioConfigured()) {
    if (process.env.DEV_MODE === 'true') {
      console.log(`[WhatsApp Sandbox Sim] -> ${redacted}: ${body}`);
      return {
        ok: true,
        sid: `SM_SIM_${Date.now().toString(36).toUpperCase()}`,
        simulated: true,
      };
    }
    return {
      ok: false,
      error: 'Twilio credentials (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN) are not configured.',
    };
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const authHeader = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  const attemptSend = async () => {
    const params = new URLSearchParams();
    params.append('From', from);
    params.append('To', formattedTo);
    params.append('Body', body);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Twilio API (${res.status}): ${errText}`);
    }

    const data = await res.json();
    return { ok: true, sid: data.sid, simulated: false };
  };

  try {
    return await attemptSend();
  } catch (firstErr) {
    console.warn(`[WhatsApp] First send to ${redacted} failed, retrying once:`, firstErr.message);
    try {
      return await attemptSend();
    } catch (secondErr) {
      console.error(`[WhatsApp] Retry to ${redacted} failed:`, secondErr.message);
      return { ok: false, error: secondErr.message };
    }
  }
}
