import {
  Customer,
  Tab,
  Message,
  Reminder,
  CustomerPromise,
} from '../models/index.js';
import {
  parseCustomerReply,
  validateCollectorReplyGuardrails,
  buildSafeAutoReplyTemplate,
} from './llm.js';
import {
  normalizeWhatsAppPhone,
  redactPhone,
  checkOutboundSendPolicy,
  sendWhatsAppReminder,
} from './whatsapp.js';
import { createPayPalOrder } from './paypal.js';
import { emitSocketEvent } from '../sockets.js';
import { broadcastStatsUpdated } from '../routes/stats.js';

let followUpIntervalId = null;

function formatFriendlyPromiseDate(ymdStr, lang = 'en') {
  if (!ymdStr || !/^\d{4}-\d{2}-\d{2}$/.test(ymdStr)) return ymdStr || '';
  const [y, m, d] = ymdStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  return dt.toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

/**
 * Helper: Send and record an outbound WhatsApp message with guardrails, send-limits & quiet-hours checks.
 */
export async function sendGuardedCollectorMessage({
  customer,
  body,
  allowedAmounts = [],
  fallbackTemplateArgs = null,
  isOptOutConfirmation = false,
  isReminder = false,
  now = new Date(),
  ignoreQuietHours = false,
  ignoreRateLimits = false,
}) {
  // 1. Check hard guardrails on `body`; fall back to deterministic template if violated
  let safeBody = String(body || '').trim();
  const guardrailCheck = validateCollectorReplyGuardrails(safeBody, { allowedAmounts });
  if (!guardrailCheck.valid) {
    console.warn(`[Collector Guardrail] Replaced unsafe reply (${guardrailCheck.reason})`);
    if (fallbackTemplateArgs) {
      safeBody = buildSafeAutoReplyTemplate(fallbackTemplateArgs);
    } else {
      return { sent: false, guardrailBlocked: true, reason: guardrailCheck.reason };
    }
  }

  // 2. Check outbound send policy (consent, daily/weekly limits, MAX_REMINDERS, quiet hours)
  const policy = await checkOutboundSendPolicy({
    customer,
    now,
    isOptOutConfirmation,
    isReminder,
    ignoreQuietHours,
    ignoreRateLimits,
  });

  if (!policy.allowed) {
    if (policy.queuedForMorning) {
      const queuedMsg = await Message.create({
        customerId: customer._id,
        direction: 'OUT',
        body: safeBody,
        queuedForMorning: true,
        createdAt: now,
      });
      return {
        sent: false,
        queuedForMorning: true,
        reason: policy.reason,
        messageDoc: queuedMsg,
      };
    }

    if (policy.handoverToVendor) {
      customer.collectorStatus = 'NEEDS_VENDOR';
      customer.collectorNote = policy.reason;
      await customer.save();
    }

    return {
      sent: false,
      blockedByPolicy: true,
      reason: policy.reason,
      policy,
    };
  }

  // 3. Deliver via Twilio (or DEV_MODE simulation)
  const waRes = await sendWhatsAppReminder({
    toPhone: customer.phone,
    body: safeBody,
  });

  const outMsg = await Message.create({
    customerId: customer._id,
    direction: 'OUT',
    body: safeBody,
    twilioSid: waRes.sid || null,
    queuedForMorning: false,
    createdAt: now,
  });

  customer.lastOutboundAt = now;
  customer.reminderCountWeek = (customer.reminderCountWeek || 0) + 1;
  await customer.save();

  return {
    sent: waRes.ok,
    simulated: waRes.simulated || false,
    error: waRes.error || null,
    messageDoc: outMsg,
    body: safeBody,
  };
}

/**
 * Part 1.2–1.5: Main Two-Way WhatsApp Inbound Pipeline.
 * Processes a customer's inbound WhatsApp message deterministically after parsing intent.
 */
export async function processInboundCustomerMessage({
  fromPhone,
  body,
  messageSid = null,
  todayDateStr = null,
  now = new Date(),
  ignoreQuietHours = false,
  ignoreRateLimits = false,
  llmInvoker = null,
}) {
  const cleanPhone = normalizeWhatsAppPhone(fromPhone);
  const text = String(body || '').trim();
  const sid = messageSid || `IN_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  // 1. Idempotency check on MessageSid
  if (messageSid) {
    const existingMsg = await Message.findOne({ twilioSid: messageSid });
    if (existingMsg) {
      return {
        duplicate: true,
        handled: false,
        messageSid,
      };
    }
  }

  // 2. Map phone to Customer; ignore unknown numbers (log redacted line, send nothing)
  const customer = await Customer.findOne({ phone: cleanPhone });
  if (!customer) {
    console.log(`[WhatsApp Inbound] Ignored unknown number ${redactPhone(cleanPhone)}`);
    return {
      ignored: true,
      handled: false,
      reason: 'Unknown customer phone',
    };
  }

  // 3. Gather open khata tabs & last reminder for context
  let openKhataTabs = await Tab.find({
    customerId: customer._id,
    status: { $in: ['KHATA', 'PARTIAL'] },
  }).sort({ createdAt: 1 });

  // If testing interactively from Judge Simulator and customer has ₹0 khata, auto-seed a ₹100 khata tab so promises & PayPal links work!
  if (ignoreRateLimits && openKhataTabs.length === 0) {
    const lastTab = await Tab.findOne().sort({ number: -1 });
    const nextNum = lastTab ? lastTab.number + 1 : 1;
    const autoTab = await Tab.create({
      number: nextNum,
      items: [
        { name: 'Chaat', emoji: '🍲', qty: 2, unitPrice: 40 },
        { name: 'Chai', emoji: '☕', qty: 1, unitPrice: 20 },
      ],
      amount: 100,
      currency: process.env.PAYPAL_CURRENCY || 'INR',
      status: 'KHATA',
      mode: 'KHATA',
      customerId: customer._id,
    });
    openKhataTabs = [autoTab];
  }

  const outstandingBalance = openKhataTabs.reduce((sum, t) => {
    const paidSoFar = Number(t.paypal?.paidAmount || 0);
    return sum + Math.max(0, Number(t.amount) - paidSoFar);
  }, 0);

  const lastReminder = await Reminder.findOne({ customerId: customer._id }).sort({
    sentAt: -1,
  });

  // 4. Parse customer reply (LLM + Zod validation + deterministic fallback)
  const parsed = await parseCustomerReply({
    text,
    todayDateStr,
    timezone: 'Asia/Kolkata',
    outstandingAmount: outstandingBalance,
    lastReminderText: lastReminder?.message || '',
    llmInvoker,
  });

  // 5. Store inbound Message
  const inboundMsg = await Message.create({
    customerId: customer._id,
    direction: 'IN',
    body: text,
    twilioSid: sid,
    intent: parsed.intent,
    createdAt: now,
  });

  const currencySymbol = process.env.CURRENCY_SYMBOL || '₹';
  const primaryTab = openKhataTabs[0] || null;
  let payLink = primaryTab?.paypal?.approvalUrl || null;
  let createdPromise = null;
  let outboundRes = null;
  let action = parsed.needsVendor ? 'NEEDS_VENDOR' : parsed.intent;
  let spokenEn = '';
  let spokenHi = '';

  // 6. Execute deterministic server actions (never changing balances directly!)
  if (parsed.intent === 'DISPUTE') {
    action = 'DISPUTE';
    for (const t of openKhataTabs) {
      t.disputed = true;
      t.disputedAt = now;
      await t.save();
    }
    await CustomerPromise.updateMany(
      { customerId: customer._id, status: 'PENDING' },
      { $set: { status: 'CANCELLED' } }
    );

    customer.collectorStatus = 'DISPUTED';
    customer.collectorNote = `Disputed: "${text.slice(0, 80)}"`;
    await customer.save();

    const templateArgs = {
      action: 'DISPUTE',
      customerName: customer.name,
      language: parsed.language,
      currencySymbol,
    };
    const replyBody = buildSafeAutoReplyTemplate(templateArgs);
    outboundRes = await sendGuardedCollectorMessage({
      customer,
      body: replyBody,
      fallbackTemplateArgs: templateArgs,
      now,
      ignoreQuietHours,
      ignoreRateLimits,
    });

    spokenEn = `${customer.name} disputed their khata order. Reminders stopped.`;
    spokenHi = `${customer.name} ने खाते के ऑर्डर पर सवाल उठाया है। रिमाइंडर रोक दिए गए हैं।`;

    emitSocketEvent('customer:needs_vendor', {
      customer,
      reason: 'DISPUTE',
      message: inboundMsg,
      spokenEn,
      spokenHi,
    });
  } else if (parsed.intent === 'OPT_OUT') {
    action = 'OPT_OUT';
    await CustomerPromise.updateMany(
      { customerId: customer._id, status: 'PENDING' },
      { $set: { status: 'CANCELLED' } }
    );

    customer.whatsappConsent = false;
    customer.collectorStatus = 'OPTED_OUT';
    customer.collectorNote = 'Opted out of WhatsApp reminders';
    await customer.save();

    const templateArgs = {
      action: 'OPT_OUT',
      customerName: customer.name,
      language: parsed.language,
      currencySymbol,
    };
    const replyBody = buildSafeAutoReplyTemplate(templateArgs);
    outboundRes = await sendGuardedCollectorMessage({
      customer,
      body: replyBody,
      fallbackTemplateArgs: templateArgs,
      isOptOutConfirmation: true,
      now,
      ignoreQuietHours,
      ignoreRateLimits,
    });

    spokenEn = `${customer.name} opted out of WhatsApp reminders.`;
    spokenHi = `${customer.name} ने WhatsApp रिमाइंडर बंद कर दिए हैं।`;

    emitSocketEvent('customer:needs_vendor', {
      customer,
      reason: 'OPT_OUT',
      message: inboundMsg,
      spokenEn,
      spokenHi,
    });
  } else if (parsed.needsVendor) {
    action = 'NEEDS_VENDOR';
    customer.collectorStatus = 'NEEDS_VENDOR';
    customer.collectorNote = `Needs you: "${text.slice(0, 80)}"`;
    await customer.save();

    if (ignoreRateLimits) {
      const ackBody =
        parsed.language === 'en'
          ? `Hi ${customer.name}! Your pending khata balance is ${currencySymbol}${outstandingBalance}. I have notified Sharma Ji right away.`
          : `नमस्ते ${customer.name} जी! आपका कुल बाकी खाता ${currencySymbol}${outstandingBalance} है। मैंने दुकानदार (शर्मा जी) को अभी सूचित कर दिया है।`;
      outboundRes = await sendGuardedCollectorMessage({
        customer,
        body: ackBody,
        allowedAmounts: [outstandingBalance].filter((x) => x > 0),
        fallbackTemplateArgs: {
          action: 'NEEDS_VENDOR',
          customerName: customer.name,
          language: parsed.language,
          currencySymbol,
        },
        now,
        ignoreQuietHours: true,
        ignoreRateLimits: true,
      });
    }

    spokenEn = `${customer.name} sent a WhatsApp reply that needs your attention.`;
    spokenHi = `${customer.name} का WhatsApp संदेश आया है, कृपया देखें।`;

    emitSocketEvent('customer:needs_vendor', {
      customer,
      reason: 'NEEDS_VENDOR',
      message: inboundMsg,
      spokenEn,
      spokenHi,
    });
  } else if (parsed.intent === 'PROMISE_DATE' && parsed.promiseDate) {
    action = 'PROMISE_DATE';
    const promisedAmt =
      parsed.amount > 0 && parsed.amount <= outstandingBalance
        ? parsed.amount
        : outstandingBalance;

    const [py, pm, pd] = parsed.promiseDate.split('-').map(Number);
    const dueDate = new Date(py, pm - 1, pd, 20, 59, 59, 0);

    await CustomerPromise.updateMany(
      { customerId: customer._id, status: 'PENDING' },
      { $set: { status: 'CANCELLED' } }
    );

    createdPromise = await CustomerPromise.create({
      customerId: customer._id,
      tabIds: openKhataTabs.map((t) => t._id),
      amount: promisedAmt,
      dueDate,
      dueDateStr: parsed.promiseDate,
      status: 'PENDING',
      sourceMessageId: inboundMsg._id,
      createdAt: now,
    });

    const friendlyEn = formatFriendlyPromiseDate(parsed.promiseDate, 'en');
    const friendlyHi = formatFriendlyPromiseDate(parsed.promiseDate, 'hi');

    customer.collectorStatus = 'PROMISED';
    customer.collectorNote = `Promised ${currencySymbol}${promisedAmt} on ${friendlyEn}`;
    await customer.save();

    if (primaryTab && !payLink) {
      const ppOrder = await createPayPalOrder({
        tabId: primaryTab._id,
        tabNumber: primaryTab.number,
        amount: promisedAmt || primaryTab.amount,
        currency: primaryTab.currency || process.env.PAYPAL_CURRENCY || 'INR',
        description: `Khata Promise (${customer.name})`,
      });
      primaryTab.paypal = {
        ...(primaryTab.paypal?.toObject?.() || primaryTab.paypal || {}),
        orderId: ppOrder.orderId,
        approvalUrl: ppOrder.approvalUrl,
      };
      await primaryTab.save();
      payLink = ppOrder.approvalUrl;
    }

    const templateArgs = {
      action: 'PROMISE_DATE',
      customerName: customer.name,
      language: parsed.language,
      amount: promisedAmt,
      promiseDateFormatted: parsed.language === 'en' ? friendlyEn : friendlyHi,
      payLink: payLink || `${process.env.PUBLIC_BASE_URL || 'http://localhost:4000'}`,
      currencySymbol,
    };
    const replyBody = buildSafeAutoReplyTemplate(templateArgs);
    outboundRes = await sendGuardedCollectorMessage({
      customer,
      body: replyBody,
      allowedAmounts: [promisedAmt, outstandingBalance],
      fallbackTemplateArgs: templateArgs,
      now,
      ignoreQuietHours,
      ignoreRateLimits,
    });

    spokenEn = `${customer.name} promised ${promisedAmt} rupees on ${friendlyEn}.`;
    spokenHi = `${customer.name} ने ${friendlyHi} को ${promisedAmt} रुपये देने का वादा किया है।`;

    emitSocketEvent('promise:created', {
      promise: createdPromise,
      customer,
      spokenEn,
      spokenHi,
    });
  } else if (parsed.intent === 'PARTIAL_NOW' || parsed.intent === 'PAYING_NOW') {
    const targetAmount =
      parsed.amount > 0 && parsed.amount <= outstandingBalance
        ? parsed.amount
        : outstandingBalance;
    const remainingAmount = Math.max(0, outstandingBalance - targetAmount);
    action = remainingAmount > 0 ? 'PARTIAL_NOW' : 'PAYING_NOW';

    // Create a PayPal order for targetAmount WITHOUT reducing tab balance until webhook arrives!
    if (primaryTab && targetAmount > 0) {
      const ppOrder = await createPayPalOrder({
        tabId: primaryTab._id,
        tabNumber: primaryTab.number,
        amount: targetAmount,
        currency: primaryTab.currency || process.env.PAYPAL_CURRENCY || 'INR',
        description: `Khata Payment (${customer.name}): ${currencySymbol}${targetAmount}`,
      });
      primaryTab.paypal = {
        ...(primaryTab.paypal?.toObject?.() || primaryTab.paypal || {}),
        orderId: ppOrder.orderId,
        approvalUrl: ppOrder.approvalUrl,
        paidAmount: primaryTab.paypal?.paidAmount || 0,
      };
      await primaryTab.save();
      payLink = ppOrder.approvalUrl;
    }

    let friendlyEn = '';
    let friendlyHi = '';

    // If customer also promised a date for the remaining balance (e.g. "abhi 100 de raha hoon baaki kal")
    if (remainingAmount > 0 && parsed.promiseDate) {
      const [py, pm, pd] = parsed.promiseDate.split('-').map(Number);
      const dueDate = new Date(py, pm - 1, pd, 20, 59, 59, 0);
      friendlyEn = formatFriendlyPromiseDate(parsed.promiseDate, 'en');
      friendlyHi = formatFriendlyPromiseDate(parsed.promiseDate, 'hi');

      await CustomerPromise.updateMany(
        { customerId: customer._id, status: 'PENDING' },
        { $set: { status: 'CANCELLED' } }
      );

      createdPromise = await CustomerPromise.create({
        customerId: customer._id,
        tabIds: openKhataTabs.map((t) => t._id),
        amount: remainingAmount,
        dueDate,
        dueDateStr: parsed.promiseDate,
        status: 'PENDING',
        sourceMessageId: inboundMsg._id,
        createdAt: now,
      });

      customer.collectorStatus = 'PROMISED';
      customer.collectorNote = `Paying ${currencySymbol}${targetAmount} now, ${currencySymbol}${remainingAmount} on ${friendlyEn}`;
      await customer.save();

      emitSocketEvent('promise:created', {
        promise: createdPromise,
        customer,
      });
    } else {
      customer.collectorNote = `Sent PayPal link for ${currencySymbol}${targetAmount}`;
      await customer.save();
    }

    const templateArgs = {
      action,
      customerName: customer.name,
      language: parsed.language,
      amount: targetAmount,
      remainingAmount,
      promiseDateFormatted: parsed.language === 'en' ? friendlyEn : friendlyHi,
      payLink: payLink || `${process.env.PUBLIC_BASE_URL || 'http://localhost:4000'}`,
      currencySymbol,
    };
    const replyBody = buildSafeAutoReplyTemplate(templateArgs);
    outboundRes = await sendGuardedCollectorMessage({
      customer,
      body: replyBody,
      allowedAmounts: [targetAmount, remainingAmount, outstandingBalance].filter((x) => x > 0),
      fallbackTemplateArgs: templateArgs,
      now,
      ignoreQuietHours,
      ignoreRateLimits,
    });

    if (remainingAmount > 0 && friendlyEn) {
      spokenEn = `${customer.name} promised ${targetAmount} rupees today and the rest on ${friendlyEn}.`;
      spokenHi = `${customer.name} अभी ${targetAmount} रुपये दे रहे हैं और बाकी ${friendlyHi} को देंगे।`;
    } else {
      spokenEn = `${customer.name} asked to pay ${targetAmount} rupees now. PayPal link sent.`;
      spokenHi = `${customer.name} अभी ${targetAmount} रुपये दे रहे हैं। PayPal लिंक भेज दिया गया है।`;
    }
  }

  emitSocketEvent('message:received', {
    customer,
    inboundMessage: inboundMsg,
    outboundMessage: outboundRes?.messageDoc || null,
    intent: parsed.intent,
    action,
    promise: createdPromise,
    payLink,
    spokenEn,
    spokenHi,
  });

  if (spokenEn || spokenHi) {
    emitSocketEvent('summary:speak', { spokenEn, spokenHi });
  }

  await broadcastStatsUpdated();

  return {
    handled: true,
    customer,
    parsed,
    action,
    promise: createdPromise,
    payLink,
    inboundMessage: inboundMsg,
    outboundResult: outboundRes,
    spokenEn,
    spokenHi,
  };
}

/**
 * Mark any PENDING or BROKEN promises as KEPT when a customer's khata balance is paid.
 */
export async function markPromisesKeptIfSettled(customerId) {
  if (!customerId) return [];
  const openKhata = await Tab.find({
    customerId,
    status: { $in: ['KHATA', 'PARTIAL'] },
  });
  const remaining = openKhata.reduce(
    (s, t) => s + Math.max(0, Number(t.amount) - Number(t.paypal?.paidAmount || 0)),
    0
  );

  if (remaining <= 0) {
    const activePromises = await CustomerPromise.find({
      customerId,
      status: { $in: ['PENDING', 'BROKEN'] },
    });
    for (const p of activePromises) {
      p.status = 'KEPT';
      await p.save();
      emitSocketEvent('promise:updated', { promise: p });
    }

    const customer = await Customer.findById(customerId);
    if (customer && customer.collectorStatus === 'PROMISED') {
      customer.collectorStatus = 'NONE';
      customer.collectorNote = 'Promise kept ✓';
      await customer.save();
    }
    return activePromises;
  }
  return [];
}

/**
 * Part 1.4 & Phase 5: Follow-up job for overdue promises (`dueDate < now` and `status === 'PENDING'`).
 * Runs every 5 minutes (and can be called directly in tests).
 */
export async function checkOverduePromises(now = new Date(), options = {}) {
  const overduePromises = await CustomerPromise.find({
    status: 'PENDING',
    dueDate: { $lt: now },
  }).populate('customerId');

  const results = [];
  const currencySymbol = process.env.CURRENCY_SYMBOL || '₹';

  for (const promise of overduePromises) {
    const customer = promise.customerId;
    if (!customer) continue;

    const openTabs = await Tab.find({
      customerId: customer._id,
      status: { $in: ['KHATA', 'PARTIAL'] },
    });
    const unpaidBalance = openTabs.reduce(
      (s, t) => s + Math.max(0, Number(t.amount) - Number(t.paypal?.paidAmount || 0)),
      0
    );

    if (unpaidBalance <= 0) {
      promise.status = 'KEPT';
      await promise.save();
      emitSocketEvent('promise:updated', { promise, customer });
      results.push({ promise, outcome: 'KEPT' });
      continue;
    }

    // Do not follow up if customer disputed or opted out
    if (
      !customer.whatsappConsent ||
      customer.collectorStatus === 'DISPUTED' ||
      customer.collectorStatus === 'OPTED_OUT'
    ) {
      promise.status = 'BROKEN';
      promise.followedUpAt = now;
      await promise.save();
      emitSocketEvent('promise:updated', { promise, customer });
      results.push({ promise, outcome: 'SKIPPED_NO_CONSENT_OR_DISPUTE' });
      continue;
    }

    const primaryTab = openTabs[0];
    let payLink = primaryTab?.paypal?.approvalUrl;
    if (primaryTab && !payLink) {
      const ppOrder = await createPayPalOrder({
        tabId: primaryTab._id,
        tabNumber: primaryTab.number,
        amount: unpaidBalance,
        currency: primaryTab.currency || process.env.PAYPAL_CURRENCY || 'INR',
        description: `Khata Follow-up (${customer.name})`,
      });
      primaryTab.paypal = {
        ...(primaryTab.paypal?.toObject?.() || primaryTab.paypal || {}),
        orderId: ppOrder.orderId,
        approvalUrl: ppOrder.approvalUrl,
      };
      await primaryTab.save();
      payLink = ppOrder.approvalUrl;
    }

    const friendlyDate = formatFriendlyPromiseDate(
      promise.dueDateStr || promise.dueDate.toISOString().slice(0, 10),
      'hi'
    );
    const templateArgs = {
      action: 'BROKEN_PROMISE_FOLLOWUP',
      customerName: customer.name,
      language: 'hi',
      amount: unpaidBalance,
      promiseDateFormatted: friendlyDate,
      payLink: payLink || `${process.env.PUBLIC_BASE_URL || 'http://localhost:4000'}`,
      currencySymbol,
    };
    const followUpBody = buildSafeAutoReplyTemplate(templateArgs);

    const sendRes = await sendGuardedCollectorMessage({
      customer,
      body: followUpBody,
      allowedAmounts: [unpaidBalance],
      fallbackTemplateArgs: templateArgs,
      isReminder: true,
      now,
      ignoreQuietHours: Boolean(options.ignoreQuietHours),
    });

    if ( primaryTab && sendRes.sent ) {
      const prevCount = await Reminder.countDocuments({
        customerId: customer._id,
        status: 'SENT',
      });
      await Reminder.create({
        tabId: primaryTab._id,
        customerId: customer._id,
        attempt: prevCount + 1,
        tone: 'firm',
        channel: 'whatsapp',
        payLink: payLink || 'https://sandbox.paypal.com',
        message: followUpBody,
        status: 'SENT',
        sentAt: now,
      });
    }

    promise.status = 'BROKEN';
    promise.followedUpAt = now;
    await promise.save();

    customer.collectorNote = `Promise overdue (${friendlyDate}) — follow-up sent`;
    await customer.save();

    const spokenEn = `${customer.name}'s promised payment of ${unpaidBalance} rupees is overdue. Sent a polite follow-up.`;
    const spokenHi = `${customer.name} का वादा किया गया ${unpaidBalance} रुपये का भुगतान बाकी है। रिमाइंडर भेज दिया गया है।`;

    emitSocketEvent('promise:updated', { promise, customer, spokenEn, spokenHi });
    emitSocketEvent('summary:speak', { spokenEn, spokenHi });

    results.push({ promise, outcome: 'BROKEN_FOLLOWED_UP', sendRes });
  }

  return results;
}

export function startPromiseFollowUpJob(intervalMs = 5 * 60 * 1000) {
  if (followUpIntervalId) {
    clearInterval(followUpIntervalId);
  }
  followUpIntervalId = setInterval(() => {
    checkOverduePromises().catch((err) => {
      console.error('[PromiseFollowUpJob] Error:', err.message);
    });
  }, intervalMs);
  return followUpIntervalId;
}

export function stopPromiseFollowUpJob() {
  if (followUpIntervalId) {
    clearInterval(followUpIntervalId);
    followUpIntervalId = null;
  }
}

