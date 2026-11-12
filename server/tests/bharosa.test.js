import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import {
  Tab,
  Customer,
  WebhookEvent,
  Message,
  CustomerPromise,
  Reminder,
  Vendor,
} from '../src/models/index.js';
import { DEFAULT_MENU, DEFAULT_CUSTOMERS, cleanSlateForRecording } from '../src/services/seed.js';
import {
  deterministicParseOrder,
  ParsedOrderSchema,
  resolveUsualOrderFromTabs,
  parseCustomerReply,
  deterministicParseCustomerReply,
  validateCollectorReplyGuardrails,
} from '../src/services/llm.js';
import { applyVerifiedPayment } from '../src/services/paymentProcessor.js';
import {
  classifyAssistantIntent,
  answerAssistantIntent,
} from '../src/routes/assistant.js';
import { buildIncomeReport } from '../src/routes/income.js';
import { computeSmartCreditSuggestion } from '../src/routes/customers.js';
import { computeRecoveredStats } from '../src/routes/stats.js';
import { buildDaySummary } from '../src/routes/day.js';
import {
  computeAdaptiveAlertTiming,
  checkOverdueTabs,
  resolveAlertSecondsForNewTab,
} from '../src/services/alerts.js';
import {
  computeTwilioSignature,
  verifyTwilioWebhookSignature,
  isQuietHoursIST,
} from '../src/services/whatsapp.js';
import {
  processInboundCustomerMessage,
  checkOverduePromises,
} from '../src/services/collector.js';

process.env.NODE_ENV = 'test';
process.env.DEV_MODE = 'true';

test('Parser & Zod Schema Validation: Hinglish numerals, menu prices, and Khata mode', async () => {
  const res = deterministicParseOrder(
    'do chaat aur ek lassi, Raju ka khata',
    DEFAULT_MENU,
    DEFAULT_CUSTOMERS
  );

  const validated = ParsedOrderSchema.parse(res);
  assert.equal(validated.mode, 'KHATA');
  assert.equal(validated.customerName, 'Raju');
  assert.equal(validated.items.length, 2);

  const chaat = validated.items.find((i) => i.name === 'Chaat');
  const lassi = validated.items.find((i) => i.name === 'Lassi');

  assert.ok(chaat);
  assert.equal(chaat.qty, 2);
  assert.equal(chaat.unitPrice, 40);

  assert.ok(lassi);
  assert.equal(lassi.qty, 1);
  assert.equal(lassi.unitPrice, 50);

  assert.equal(res.amount, 130);
  assert.equal(res.needsConfirmation, false);
});

test('Parser & Zod Schema Validation: Flagged confirmation on unknown menu item or empty input', async () => {
  const emptyRes = deterministicParseOrder('', DEFAULT_MENU, DEFAULT_CUSTOMERS);
  assert.equal(emptyRes.needsConfirmation, true);
  assert.equal(emptyRes.confidence, 0);

  const unknownRes = deterministicParseOrder('do pizza', DEFAULT_MENU, DEFAULT_CUSTOMERS);
  assert.equal(unknownRes.needsConfirmation, true);
  assert.ok(unknownRes.confidence < 0.6);
});

test('Part B3 ("The Usual" for Regulars): Detects usual phrase and picks most frequent combo with tie-break by most recent', async () => {
  const parsedPhrase = deterministicParseOrder(
    'Raju ka roz wala',
    DEFAULT_MENU,
    DEFAULT_CUSTOMERS
  );
  assert.equal(parsedPhrase.usual, true);
  assert.equal(parsedPhrase.customerName, 'Raju');

  const noHistory = resolveUsualOrderFromTabs([], DEFAULT_MENU, 'Raju');
  assert.equal(noHistory.found, false);
  assert.equal(noHistory.needsConfirmation, true);
  assert.match(noHistory.reason, /No usual order found for Raju/);

  const sampleTabs = [
    {
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2),
      items: [
        { name: 'Chaat', qty: 2, unitPrice: 40 },
        { name: 'Chai', qty: 1, unitPrice: 20 },
      ],
    },
    {
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
      items: [{ name: 'Lassi', qty: 1, unitPrice: 50 }],
    },
    {
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 48),
      items: [
        { name: 'Chai', qty: 1, unitPrice: 20 },
        { name: 'Chaat', qty: 2, unitPrice: 40 },
      ],
    },
  ];

  const resolved = resolveUsualOrderFromTabs(sampleTabs, DEFAULT_MENU, 'Raju');
  assert.equal(resolved.found, true);
  assert.equal(resolved.frequencyCount, 2);
  assert.equal(resolved.amount, 100);
  assert.equal(resolved.items.length, 2);

  const tieTabs = [
    {
      createdAt: new Date(Date.now() - 1000 * 60 * 10),
      items: [{ name: 'Samosa', qty: 2, unitPrice: 15 }],
    },
    {
      createdAt: new Date(Date.now() - 1000 * 60 * 120),
      items: [{ name: 'Lassi', qty: 1, unitPrice: 50 }],
    },
  ];
  const tieResolved = resolveUsualOrderFromTabs(tieTabs, DEFAULT_MENU, 'Raju');
  assert.equal(tieResolved.found, true);
  assert.equal(tieResolved.items[0].name, 'Samosa');
  assert.equal(tieResolved.amount, 30);
});

test('Part B4 (Smart Credit Limit): Deterministic rule from repayment rate and average repayment time', async () => {
  const now = Date.now();
  const fastTabs = [
    {
      mode: 'KHATA',
      status: 'PAID',
      amount: 100,
      createdAt: new Date(now - 3 * 86400000),
      paidAt: new Date(now - 2 * 86400000),
    },
    {
      mode: 'KHATA',
      status: 'PAID',
      amount: 100,
      createdAt: new Date(now - 2 * 86400000),
      paidAt: new Date(now - 1 * 86400000),
    },
  ];

  const fastSuggestion = computeSmartCreditSuggestion('Raju', fastTabs, true);
  assert.equal(fastSuggestion.stats.repaymentRate, 1);
  assert.equal(fastSuggestion.stats.avgDaysToRepay, 1);
  assert.equal(fastSuggestion.suggestedLimit, 350);
  assert.equal(fastSuggestion.isDemoData, true);

  const slowTabs = [
    {
      mode: 'KHATA',
      status: 'KHATA',
      amount: 120,
      createdAt: new Date(now - 5 * 86400000),
    },
    {
      mode: 'KHATA',
      status: 'KHATA',
      amount: 80,
      createdAt: new Date(now - 3 * 86400000),
    },
  ];
  const slowSuggestion = computeSmartCreditSuggestion('Mohan', slowTabs, false);
  assert.equal(slowSuggestion.stats.repaymentRate, 0);
  assert.equal(slowSuggestion.suggestedLimit, 100);
});

test('Round 3 Part 2 (Adaptive Alert Timing): Bucketing, p90 * 1.2 clamp, fallback when < MIN_SAMPLES, and adaptiveEnabled=false', async () => {
  const baseDate = new Date(2026, 10, 4, 0, 0, 0);
  const sampleTabs = [];

  // 16 samples in Evening Rush (18:00-21:00, hour 19): 14 samples at 35s, 2 samples at 40s -> p90 = 40s -> round(40 * 1.2) = 48s
  for (let i = 0; i < 16; i++) {
    const durSec = i < 14 ? 35 : 40;
    const cAt = new Date(baseDate.getTime() + 19 * 3600 * 1000 + i * 60000);
    sampleTabs.push({
      mode: 'PAY_NOW',
      status: 'PAID',
      paymentMethod: 'PAYPAL',
      createdAt: cAt,
      paidAt: new Date(cAt.getTime() + durSec * 1000),
    });
  }

  // 15 samples in Morning (07:00-11:00, hour 8) with very fast 10s payments -> p90 = 10s -> round(10 * 1.2) = 12s -> clamped to MIN_ALERT = 20s
  for (let i = 0; i < 15; i++) {
    const cAt = new Date(baseDate.getTime() + 8 * 3600 * 1000 + i * 60000);
    sampleTabs.push({
      mode: 'PAY_NOW',
      status: 'PAID',
      paymentMethod: 'PAYPAL',
      createdAt: cAt,
      paidAt: new Date(cAt.getTime() + 10 * 1000),
    });
  }

  // Only 5 samples in Lunch (11:00-15:00, hour 13) -> below MIN_SAMPLES (15) -> falls back to default 30s (`source: "default"`)
  for (let i = 0; i < 5; i++) {
    const cAt = new Date(baseDate.getTime() + 13 * 3600 * 1000 + i * 60000);
    sampleTabs.push({
      mode: 'PAY_NOW',
      status: 'PAID',
      paymentMethod: 'PAYPAL',
      createdAt: cAt,
      paidAt: new Date(cAt.getTime() + 50 * 1000),
    });
  }

  const report = computeAdaptiveAlertTiming(sampleTabs, {
    defaultSeconds: 30,
    minSamples: 15,
    minAlert: 20,
    maxAlert: 120,
    adaptiveEnabled: true,
    nowHour: 19,
  });

  const eveningBucket = report.buckets.find((b) => b.id === 'evening');
  assert.equal(eveningBucket.source, 'learned');
  assert.equal(eveningBucket.samples, 16);
  assert.equal(eveningBucket.p90, 40);
  assert.equal(eveningBucket.alertSeconds, 48);
  assert.equal(report.currentAlertSeconds, 48);

  const morningBucket = report.buckets.find((b) => b.id === 'morning');
  assert.equal(morningBucket.source, 'learned');
  assert.equal(morningBucket.alertSeconds, 20); // clamped to MIN_ALERT=20

  const lunchBucket = report.buckets.find((b) => b.id === 'midday');
  assert.equal(lunchBucket.source, 'default');
  assert.equal(lunchBucket.alertSeconds, 30);

  // When adaptiveEnabled = false, all buckets and currentAlertSeconds use defaultSeconds (30)
  const reportOff = computeAdaptiveAlertTiming(sampleTabs, {
    defaultSeconds: 30,
    minSamples: 15,
    adaptiveEnabled: false,
    nowHour: 19,
  });
  assert.equal(reportOff.currentAlertSeconds, 30);
  assert.equal(
    reportOff.buckets.find((b) => b.id === 'evening').alertSeconds,
    30
  );
});

test('Round 3 Part 1 (Twilio Signature, Guardrails & Fallback Reply Rules)', async () => {
  // 1. Twilio Signature Verification (valid vs invalid)
  const token = 'test_twilio_secret_token_123';
  const url = 'https://bharosa.example.com/api/whatsapp/inbound';
  const params = { From: 'whatsapp:+919876543210', Body: 'Friday ko de dunga', MessageSid: 'SM123' };
  const validSig = computeTwilioSignature(token, url, params);

  assert.equal(
    verifyTwilioWebhookSignature({
      authToken: token,
      signatureHeader: validSig,
      url,
      params,
      devBypass: false,
    }),
    true
  );

  assert.equal(
    verifyTwilioWebhookSignature({
      authToken: token,
      signatureHeader: 'invalid_signature_xyz',
      url,
      params,
      devBypass: false,
    }),
    false
  );

  // 2. Hard Guardrails Validator (rejects threats, police, shaming, discounts, and altered amounts)
  assert.equal(
    validateCollectorReplyGuardrails('We will call the police if you do not pay today!').valid,
    false
  );
  assert.equal(
    validateCollectorReplyGuardrails('Take a 50% discount and pay ₹50 now.').valid,
    false
  );
  assert.equal(
    validateCollectorReplyGuardrails('Please pay ₹999 using this link.', {
      allowedAmounts: [160],
    }).valid,
    false
  );
  assert.equal(
    validateCollectorReplyGuardrails(
      'Thank you Raju! Please pay ₹160 using your PayPal link: https://sandbox.paypal.com',
      { allowedAmounts: [160] }
    ).valid,
    true
  );

  // 3. Fallback Keyword Rules (no LLM)
  const today = '2026-11-04'; // Wednesday
  const kalReply = deterministicParseCustomerReply({
    text: 'bhaiya kal de dunga',
    todayDateStr: today,
    outstandingAmount: 160,
  });
  assert.equal(kalReply.intent, 'PROMISE_DATE');
  assert.equal(kalReply.promiseDate, '2026-11-05');

  const friReply = deterministicParseCustomerReply({
    text: 'Friday ko de dunga',
    todayDateStr: today,
    outstandingAmount: 160,
  });
  assert.equal(friReply.intent, 'PROMISE_DATE');
  assert.equal(friReply.promiseDate, '2026-11-06');

  const partialReply = deterministicParseCustomerReply({
    text: 'abhi 100 de raha hoon baaki kal',
    todayDateStr: today,
    outstandingAmount: 160,
  });
  assert.equal(partialReply.intent, 'PARTIAL_NOW');
  assert.equal(partialReply.amount, 100);
  assert.equal(partialReply.promiseDate, '2026-11-05');

  const disputeReply = deterministicParseCustomerReply({
    text: 'mera nahi tha ye order',
    todayDateStr: today,
    outstandingAmount: 160,
  });
  assert.equal(disputeReply.intent, 'DISPUTE');

  const optOutReply = deterministicParseCustomerReply({
    text: 'stop messages band karo',
    todayDateStr: today,
    outstandingAmount: 160,
  });
  assert.equal(optOutReply.intent, 'OPT_OUT');

  // Quiet hours check (22:30 IST = 17:00 UTC -> true; 14:30 IST = 09:00 UTC -> false)
  assert.equal(isQuietHoursIST(new Date('2026-11-04T17:00:00Z')), true);
  assert.equal(isQuietHoursIST(new Date('2026-11-04T09:00:00Z')), false);
});

test('Webhook Payment Processor + Two-Way WhatsApp Collector Pipeline (Mocked LLM) + Send Limits & Broken Promise Follow-up', async () => {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/bharosa_test';
  await mongoose.connect(mongoUri);
  await Tab.deleteMany({});
  await Customer.deleteMany({});
  await WebhookEvent.deleteMany({});
  await Message.deleteMany({});
  await CustomerPromise.deleteMany({});
  await Reminder.deleteMany({});
  await Vendor.deleteMany({});

  try {
    await Vendor.create({
      name: 'Sharma Ji Chaat & Chai Stall',
      language: 'hi',
      adaptiveAlertsEnabled: true,
      menu: DEFAULT_MENU,
    });

    // 1. Create an OPEN tab with custom alertAfterSeconds=45 and verify checkOverdueTabs respects it
    const tab = await Tab.create({
      number: 101,
      items: [{ name: 'Chaat', qty: 2, unitPrice: 40 }],
      amount: 80,
      currency: 'USD',
      status: 'OPEN',
      mode: 'PAY_NOW',
      alertAfterSeconds: 45,
      createdAt: new Date(Date.now() - 35000), // 35s elapsed (< 45s alertAfterSeconds!)
      paypal: {
        orderId: 'ORD-TEST-101',
        approvalUrl: 'https://sandbox.paypal.com/checkoutnow?token=ORD-TEST-101',
      },
    });

    // At 35s elapsed, tab with alertAfterSeconds=45 must NOT alert yet
    const earlyAlerts = await checkOverdueTabs();
    assert.equal(earlyAlerts.length, 0);

    // Backdate to 48s elapsed -> now it MUST alert
    await Tab.findByIdAndUpdate(tab._id, {
      $set: { createdAt: new Date(Date.now() - 48000) },
    });
    const triggeredAlerts = await checkOverdueTabs();
    assert.equal(triggeredAlerts.length, 1);
    assert.equal(String(triggeredAlerts[0]._id), String(tab._id));

    // 2. Settle tab 101 via verified payment processor
    const fullRes = await applyVerifiedPayment({
      tabId: tab._id,
      orderId: 'ORD-TEST-101',
      captureId: 'CAP-FULL-101',
      paidAmount: 80,
      currency: 'USD',
      eventId: 'WH-FULL-101',
    });
    assert.equal(fullRes.tab.status, 'PAID');

    // 3. Seed Raju with a ₹160 KHATA tab for Two-Way Collector tests
    const raju = await Customer.create({
      name: 'Raju',
      phone: '+919876543210',
      whatsappConsent: true,
    });

    const khataTab = await Tab.create({
      number: 102,
      items: [{ name: 'Chaat', qty: 4, unitPrice: 40 }],
      amount: 160,
      currency: 'USD',
      status: 'KHATA',
      mode: 'KHATA',
      customerId: raju._id,
    });

    const daytimeNow = new Date('2026-11-04T09:00:00Z'); // 14:30 IST (not quiet hours)

    // 4. Unknown phone number is ignored and sends nothing
    const unknownRes = await processInboundCustomerMessage({
      fromPhone: 'whatsapp:+919999999999',
      body: 'Friday ko de dunga',
      messageSid: 'SM-UNKNOWN-1',
      todayDateStr: '2026-11-04',
      now: daytimeNow,
    });
    assert.equal(unknownRes.ignored, true);

    // 5. PROMISE_DATE with mocked LLM + amount over balance (999 > 160) ignored -> defaults to 160
    const promiseRes = await processInboundCustomerMessage({
      fromPhone: 'whatsapp:+919876543210',
      body: 'Friday ko de dunga',
      messageSid: 'SM-RAJU-PROMISE-1',
      todayDateStr: '2026-11-04',
      now: daytimeNow,
      llmInvoker: async () => ({
        intent: 'PROMISE_DATE',
        promiseDate: '2026-11-06',
        amount: 999, // over balance (160) -> must be ignored and capped to 160
        language: 'hi',
        confidence: 0.95,
      }),
    });
    assert.equal(promiseRes.handled, true);
    assert.equal(promiseRes.action, 'PROMISE_DATE');
    assert.equal(promiseRes.promise.amount, 160);
    assert.equal(promiseRes.promise.status, 'PENDING');
    assert.equal(promiseRes.outboundResult.sent, true);

    // 6. Duplicate MessageSid is ignored idempotently
    const dupMsgRes = await processInboundCustomerMessage({
      fromPhone: 'whatsapp:+919876543210',
      body: 'Friday ko de dunga',
      messageSid: 'SM-RAJU-PROMISE-1',
      todayDateStr: '2026-11-04',
      now: daytimeNow,
    });
    assert.equal(dupMsgRes.duplicate, true);

    // 7. PARTIAL_NOW ("abhi 100 de raha hoon") -> generates PayPal link for 100, does NOT reduce balance until webhook
    const partialInbound = await processInboundCustomerMessage({
      fromPhone: 'whatsapp:+919876543210',
      body: 'abhi 100 de raha hoon',
      messageSid: 'SM-RAJU-PARTIAL-2',
      todayDateStr: '2026-11-04',
      now: daytimeNow,
      llmInvoker: async () => ({
        intent: 'PARTIAL_NOW',
        promiseDate: null,
        amount: 100,
        language: 'hi',
        confidence: 0.92,
      }),
    });
    assert.equal(partialInbound.action, 'PARTIAL_NOW');
    assert.ok(partialInbound.payLink);

    const tabBeforeWebhook = await Tab.findById(khataTab._id);
    assert.equal(tabBeforeWebhook.status, 'KHATA');
    assert.equal(tabBeforeWebhook.paypal.paidAmount, 0); // Balance untouched before webhook!

    // 8. Daily Send Limit: Raju has now received 2 outbound messages today (MAX_DAILY_OUTBOUND = 2).
    // A 3rd outbound auto-reply on the same day must be blocked by policy!
    const thirdInbound = await processInboundCustomerMessage({
      fromPhone: 'whatsapp:+919876543210',
      body: 'abhi 50 de raha hoon',
      messageSid: 'SM-RAJU-LIMIT-3',
      todayDateStr: '2026-11-04',
      now: daytimeNow,
      llmInvoker: async () => ({
        intent: 'PARTIAL_NOW',
        promiseDate: null,
        amount: 50,
        language: 'hi',
        confidence: 0.9,
      }),
    });
    assert.equal(thirdInbound.outboundResult.sent, false);
    assert.equal(thirdInbound.outboundResult.blockedByPolicy, true);

    // 9. Low confidence (< 0.6) becomes NEEDS_VENDOR
    const lowConfRes = await processInboundCustomerMessage({
      fromPhone: 'whatsapp:+919876543210',
      body: 'pata nahi bhaiya baad mein dekhte hain',
      messageSid: 'SM-RAJU-LOWCONF-4',
      todayDateStr: '2026-11-04',
      now: daytimeNow,
      llmInvoker: async () => ({
        intent: 'OTHER',
        promiseDate: null,
        amount: 0,
        language: 'hi',
        confidence: 0.35,
      }),
    });
    assert.equal(lowConfRes.action, 'NEEDS_VENDOR');
    const rajuAfterLowConf = await Customer.findById(raju._id);
    assert.equal(rajuAfterLowConf.collectorStatus, 'NEEDS_VENDOR');

    // 10. Broken-promise follow-up job: backdate Raju's PENDING promise dueDate to yesterday and clear today's outbound count
    await Message.deleteMany({ customerId: raju._id, direction: 'OUT' });
    await Customer.findByIdAndUpdate(raju._id, { $set: { collectorStatus: 'PROMISED' } });
    await CustomerPromise.updateMany(
      { customerId: raju._id },
      { $set: { status: 'PENDING', dueDate: new Date(daytimeNow.getTime() - 86400000) } }
    );

    const followUpResults = await checkOverduePromises(daytimeNow, { ignoreQuietHours: true });
    assert.equal(followUpResults.length, 1);
    assert.equal(followUpResults[0].outcome, 'BROKEN_FOLLOWED_UP');
    const brokenPromise = await CustomerPromise.findById(followUpResults[0].promise._id);
    assert.equal(brokenPromise.status, 'BROKEN');

    // 11. When verified PayPal webhook settles Raju's ₹160 khata tab, promise transitions to KEPT!
    await applyVerifiedPayment({
      tabId: khataTab._id,
      orderId: khataTab.paypal?.orderId || 'ORD-KHATA-102',
      captureId: 'CAP-KHATA-102',
      paidAmount: 160,
      currency: 'USD',
      eventId: 'WH-KHATA-102',
    });
    const keptPromise = await CustomerPromise.findById(brokenPromise._id);
    assert.equal(keptPromise.status, 'KEPT');

    // 12. DISPUTE & OPT_OUT on a second customer (Sunita)
    const sunita = await Customer.create({
      name: 'Sunita',
      phone: '+919876543211',
      whatsappConsent: true,
    });
    const sunitaTab = await Tab.create({
      number: 103,
      items: [{ name: 'Lassi', qty: 2, unitPrice: 50 }],
      amount: 100,
      currency: 'USD',
      status: 'KHATA',
      mode: 'KHATA',
      customerId: sunita._id,
    });

    const disputeInbound = await processInboundCustomerMessage({
      fromPhone: 'whatsapp:+919876543211',
      body: 'mera nahi tha ye order',
      messageSid: 'SM-SUNITA-DISPUTE-1',
      todayDateStr: '2026-11-04',
      now: daytimeNow,
      llmInvoker: async () => ({
        intent: 'DISPUTE',
        promiseDate: null,
        amount: 0,
        language: 'hi',
        confidence: 0.95,
      }),
    });
    assert.equal(disputeInbound.action, 'DISPUTE');
    const updatedSunitaTab = await Tab.findById(sunitaTab._id);
    assert.equal(updatedSunitaTab.disputed, true);

    const optOutInbound = await processInboundCustomerMessage({
      fromPhone: 'whatsapp:+919876543211',
      body: 'band karo',
      messageSid: 'SM-SUNITA-OPTOUT-2',
      todayDateStr: '2026-11-04',
      now: daytimeNow,
      llmInvoker: async () => ({
        intent: 'OPT_OUT',
        promiseDate: null,
        amount: 0,
        language: 'hi',
        confidence: 0.98,
      }),
    });
    assert.equal(optOutInbound.action, 'OPT_OUT');
    const updatedSunita = await Customer.findById(sunita._id);
    assert.equal(updatedSunita.whatsappConsent, false);
    assert.equal(updatedSunita.collectorStatus, 'OPTED_OUT');
  } finally {
    await cleanSlateForRecording();
    await mongoose.disconnect();
  }
});
