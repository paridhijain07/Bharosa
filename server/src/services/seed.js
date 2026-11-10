import crypto from 'crypto';
import { Vendor, Customer, Tab, Message } from '../models/index.js';

export const DEFAULT_MENU = [
  { name: 'Chaat', emoji: '🍲', aliases: ['chaat', 'chat', 'samosa chaat', 'aloo chaat', 'चाट'], price: 40 },
  { name: 'Chai', emoji: '☕', aliases: ['chai', 'tea', 'masala chai', 'cutting', 'चाय'], price: 20 },
  { name: 'Samosa', emoji: '🥟', aliases: ['samosa', 'samoosa', 'समोसा'], price: 15 },
  { name: 'Lassi', emoji: '🥛', aliases: ['lassi', 'sweet lassi', 'लस्सी'], price: 50 },
  { name: 'Vada Pav', emoji: '🍔', aliases: ['vada pav', 'wada pav', 'vadapav', 'वड़ा पाव'], price: 25 },
  { name: 'Kachori', emoji: '🍘', aliases: ['kachori', 'kasta kachori', 'कचौड़ी'], price: 30 },
];

export const DEFAULT_CUSTOMERS = [
  { name: 'Raju', phone: '+919876543210', whatsappConsent: true, creditLimit: 300, isDemoSeeded: true },
  { name: 'Sunita', phone: '+919876543211', whatsappConsent: true, creditLimit: 400, isDemoSeeded: true },
  { name: 'Amit', phone: '+919876543212', whatsappConsent: false, creditLimit: null, isDemoSeeded: true },
];

export async function ensureSeedData() {
  let vendor = await Vendor.findOne();
  if (!vendor) {
    vendor = await Vendor.create({
      name: 'Sharma Ji Chaat & Chai Stall',
      language: 'hi',
      shareToken: crypto.randomBytes(16).toString('hex'),
      isDemoSeeded: true,
      adaptiveAlertsEnabled: true,
      menu: DEFAULT_MENU,
    });
    console.log('[Seed] Created default Vendor with street-stall menu');
  } else {
    let changed = false;
    if (!vendor.shareToken) {
      vendor.shareToken = crypto.randomBytes(16).toString('hex');
      changed = true;
    }
    if (vendor.adaptiveAlertsEnabled === undefined) {
      vendor.adaptiveAlertsEnabled = true;
      changed = true;
    }
    const emojiMap = Object.fromEntries(DEFAULT_MENU.map((m) => [m.name, m.emoji]));
    vendor.menu = (vendor.menu || []).map((m) => ({
      name: m.name,
      emoji: m.emoji || emojiMap[m.name] || '🍲',
      aliases: m.aliases,
      price: m.price,
    }));
    if (changed) await vendor.save();
  }

  const customerCount = await Customer.countDocuments();
  let customers = [];
  if (customerCount === 0) {
    customers = await Customer.insertMany(DEFAULT_CUSTOMERS);
    console.log('[Seed] Created default regular customers (Raju, Sunita, Amit)');
  } else {
    customers = await Customer.find();
  }

  // Seed realistic 7-day historical tabs:
  // - All 7 local calendar days populated
  // - Enough PAY_NOW PayPal samples in Evening Rush (18:00-21:00, >=15 samples, ~38s p90 -> 45s alert)
  //   and Morning (07:00-11:00, >=15 samples, ~18s p90 -> 22s alert) to demonstrate Adaptive Alert Timing
  // - Recovered-after-alert orders & Raju's repeated "usual" orders (2x Chaat + 1x Chai = ₹100)
  const tabCount = await Tab.countDocuments();
  if (tabCount === 0) {
    const raju = customers.find((c) => c.name === 'Raju') || customers[0];
    const sunita = customers.find((c) => c.name === 'Sunita') || customers[1];
    const now = new Date();
    const historicalTabs = [];
    let num = 1;

    const dailySamples = [
      { daysAgo: 6, eveningPayNow: [40, 60, 40], morningPayNow: [20, 40, 20], rajuKhataPaid: 100, cashOrders: [40], recoveredIdx: 0 },
      { daysAgo: 5, eveningPayNow: [40, 80, 40], morningPayNow: [40, 20, 40], rajuKhataPaid: 100, cashOrders: [30], recoveredIdx: 1 },
      { daysAgo: 4, eveningPayNow: [60, 40, 40], morningPayNow: [20, 40], rajuKhataPaid: 0, cashOrders: [50], recoveredIdx: -1 },
      { daysAgo: 3, eveningPayNow: [40, 60, 40], morningPayNow: [40, 20, 20], rajuKhataPaid: 100, cashOrders: [40], recoveredIdx: 0 },
      { daysAgo: 2, eveningPayNow: [40, 80, 40], morningPayNow: [20, 40], rajuKhataPaid: 0, cashOrders: [30], recoveredIdx: 1 },
      { daysAgo: 1, eveningPayNow: [60, 40, 40], morningPayNow: [40, 20, 40], rajuKhataPaid: 100, cashOrders: [50], recoveredIdx: 0 },
      { daysAgo: 0, eveningPayNow: [], morningPayNow: [40, 40], rajuKhataPaid: 0, cashOrders: [40], recoveredIdx: 0 },
    ];

    const eveningDurationsSec = [30, 33, 35, 36, 37, 38, 38, 34, 32, 36, 37, 38, 35, 39, 34, 37, 38, 36];
    const morningDurationsSec = [13, 15, 16, 17, 18, 18, 15, 14, 17, 18, 16, 19, 15, 17, 18, 16, 17];
    let eveCursor = 0;
    let mornCursor = 0;

    for (const sample of dailySamples) {
      const y = now.getFullYear();
      const m = now.getMonth();
      const d = now.getDate() - sample.daysAgo;

      // 1. Morning PAY_NOW PayPal orders (08:30 local time)
      sample.morningPayNow.forEach((amt, idx) => {
        const baseMorning = new Date(y, m, d, 8, 15 + idx * 7, 0, 0);
        const dt =
          sample.daysAgo === 0 && baseMorning.getTime() > now.getTime() - 120000
            ? new Date(now.getTime() - (35 - idx * 5) * 60 * 1000)
            : baseMorning;

        const durSec = morningDurationsSec[mornCursor % morningDurationsSec.length];
        mornCursor++;
        const wasRecovered = sample.daysAgo === 0 && idx === sample.recoveredIdx;
        const alertedAt = wasRecovered ? new Date(dt.getTime() + 31000) : null;
        const paidAt = wasRecovered
          ? new Date(dt.getTime() + 48000)
          : new Date(dt.getTime() + durSec * 1000);

        historicalTabs.push({
          number: num,
          items: [{ name: 'Chai', qty: Math.max(1, Math.round(amt / 20)), unitPrice: 20 }],
          amount: amt,
          currency: 'INR',
          status: 'PAID',
          mode: 'PAY_NOW',
          paymentMethod: 'PAYPAL',
          alertAfterSeconds: 22,
          paypal: {
            orderId: `SEED-PP-ORD-${num}`,
            captureId: `SEED-PP-CAP-${num}`,
            paidAmount: amt,
          },
          createdAt: dt,
          alertedAt,
          paidAt,
        });
        num++;
      });

      // 2. Evening Rush PAY_NOW PayPal orders (19:00 local time, 18-21 bucket)
      sample.eveningPayNow.forEach((amt, idx) => {
        const dt = new Date(y, m, d, 19, 5 + idx * 8, 0, 0);
        const durSec = eveningDurationsSec[eveCursor % eveningDurationsSec.length];
        eveCursor++;
        const wasRecovered = idx === sample.recoveredIdx;
        const alertedAt = wasRecovered ? new Date(dt.getTime() + 30000) : null;
        const paidAt = wasRecovered
          ? new Date(dt.getTime() + 44000)
          : new Date(dt.getTime() + durSec * 1000);

        historicalTabs.push({
          number: num,
          items: [{ name: 'Chaat', qty: Math.max(1, Math.round(amt / 40)), unitPrice: 40 }],
          amount: amt,
          currency: 'INR',
          status: 'PAID',
          mode: 'PAY_NOW',
          paymentMethod: 'PAYPAL',
          alertAfterSeconds: 45,
          paypal: {
            orderId: `SEED-PP-ORD-${num}`,
            captureId: `SEED-PP-CAP-${num}`,
            paidAmount: amt,
          },
          createdAt: dt,
          alertedAt,
          paidAt,
        });
        num++;
      });

      // 3. Raju's settled KHATA orders (gives Raju a "usual" of 2x Chaat + 1x Chai = ₹100 and fast 1-day repayment history)
      if (raju && sample.rajuKhataPaid > 0) {
        const dt = new Date(y, m, d, 13, 0, 0, 0);
        historicalTabs.push({
          number: num,
          items: [
            { name: 'Chaat', qty: 2, unitPrice: 40 },
            { name: 'Chai', qty: 1, unitPrice: 20 },
          ],
          amount: 100,
          currency: 'INR',
          status: 'PAID',
          mode: 'KHATA',
          customerId: raju._id,
          paymentMethod: 'PAYPAL',
          paypal: {
            orderId: `SEED-PP-ORD-${num}`,
            captureId: `SEED-PP-CAP-${num}`,
            paidAmount: 100,
          },
          createdAt: dt,
          paidAt: new Date(dt.getTime() + 24 * 3600 * 1000),
        });
        num++;
      }

      // 4. Cash orders
      sample.cashOrders.forEach((amt, idx) => {
        const baseNoon = new Date(y, m, d, 12, 30 + idx * 10, 0, 0);
        const dt =
          sample.daysAgo === 0 && baseNoon.getTime() > now.getTime() - 60000
            ? new Date(now.getTime() - 20 * 60 * 1000)
            : baseNoon;

        historicalTabs.push({
          number: num,
          items: [{ name: 'Samosa', qty: 2, unitPrice: 15 }],
          amount: amt,
          currency: 'INR',
          status: 'PAID',
          mode: sunita && idx === 0 ? 'KHATA' : 'PAY_NOW',
          customerId: sunita && idx === 0 ? sunita._id : null,
          paymentMethod: 'CASH',
          createdAt: dt,
          paidAt: new Date(dt.getTime() + 10000),
        });
        num++;
      });
    }

    // Add 1 active Khata tab for Raju (₹160) so partial-now ("abhi 100 de raha hoon") and promise-date ("Friday ko de dunga") demos work immediately
    if (raju) {
      const rajuOpenTab = {
        number: num++,
        items: [
          { name: 'Chaat', qty: 3, unitPrice: 40 },
          { name: 'Chai', qty: 2, unitPrice: 20 },
        ],
        amount: 160,
        currency: 'INR',
        status: 'KHATA',
        mode: 'KHATA',
        customerId: raju._id,
        createdAt: new Date(now.getTime() - 2 * 3600 * 1000),
      };
      historicalTabs.push(rajuOpenTab);
    }

    // Add 1 active Khata tab for Sunita (₹90)
    if (sunita) {
      historicalTabs.push({
        number: num++,
        items: [
          { name: 'Lassi', qty: 1, unitPrice: 50 },
          { name: 'Chaat', qty: 1, unitPrice: 40 },
        ],
        amount: 90,
        currency: 'INR',
        status: 'KHATA',
        mode: 'KHATA',
        customerId: sunita._id,
        createdAt: new Date(now.getTime() - 4 * 3600 * 1000),
      });
    }

    await Tab.insertMany(historicalTabs);

    // Seed an initial outbound reminder message for Raju so his conversation thread is ready
    const msgCount = await Message.countDocuments();
    if (msgCount === 0 && raju) {
      await Message.create({
        customerId: raju._id,
        direction: 'OUT',
        body: 'नमस्ते राजू जी! 🙏 शर्मा जी चाट स्टॉल से याद दिला रहे हैं — आपका ₹160 (3x Chaat, 2x Chai) खाता बाकी है।',
        twilioSid: 'SM_SEED_OUT_1',
        createdAt: new Date(now.getTime() - 45 * 60 * 1000),
      });
    }

    console.log(`[Seed] Seeded ${historicalTabs.length} demo tabs across 7 days (with adaptive timing & khata history)`);
  } else {
    // Ensure any legacy USD tabs are migrated to INR
    await Tab.updateMany({ currency: 'USD' }, { $set: { currency: 'INR' } });
  }

  return vendor;
}

/**
 * Reset the live workspace into the ideal 90-second Judge Pitch state:
 * - Preserves historical PAID tabs so Bharosa Score & Adaptive Alert Timing stay rich
 * - Cleans up stale unpaid/cancelled tabs
 * - Creates 1 fresh OPEN order (2 Chaat, 1 Chai — ₹100) for Walk-Off / Fraud Shield / 1-Click Pay
 * - Creates 1 fresh Group Order (2 Lassi, 2 Chaat — ₹180) for Split ÷2 PayPal Checkout
 * - Ensures Raju has an active ₹160 Khata tab and a clean WhatsApp thread for the AI Collector demo
 */
export async function resetPitchState() {
  await ensureSeedData();
  await Tab.updateMany({ currency: 'USD' }, { $set: { currency: 'INR' } });

  const customers = await Customer.find();
  const raju = customers.find((c) => c.name === 'Raju') || customers[0];
  const sunita = customers.find((c) => c.name === 'Sunita') || customers[1];

  // Remove old OPEN / PARTIAL / CANCELLED / KHATA tabs so the active queue is crisp
  await Tab.deleteMany({ status: { $in: ['OPEN', 'PARTIAL', 'CANCELLED', 'KHATA'] } });

  const highestTab = await Tab.findOne().sort({ number: -1 });
  let nextNum = (highestTab?.number || 40) + 1;
  const now = new Date();

  const freshTabs = [];

  // 1. Raju's active ₹160 Khata tab
  if (raju) {
    freshTabs.push({
      number: nextNum++,
      items: [
        { name: 'Chaat', qty: 3, unitPrice: 40 },
        { name: 'Chai', qty: 2, unitPrice: 20 },
      ],
      amount: 160,
      currency: 'INR',
      status: 'KHATA',
      mode: 'KHATA',
      customerId: raju._id,
      createdAt: new Date(now.getTime() - 90 * 60 * 1000),
    });

    await Message.deleteMany({ customerId: raju._id });
    await Message.create({
      customerId: raju._id,
      direction: 'OUT',
      body: 'नमस्ते राजू जी! 🙏 शर्मा जी चाट स्टॉल से याद दिला रहे हैं — आपका ₹160 (3x Chaat, 2x Chai) खाता बाकी है।',
      twilioSid: `SM_PITCH_${Date.now()}`,
      createdAt: new Date(now.getTime() - 15 * 60 * 1000),
    });
  }

  // 2. Sunita's active ₹90 Khata tab
  if (sunita) {
    freshTabs.push({
      number: nextNum++,
      items: [
        { name: 'Lassi', qty: 1, unitPrice: 50 },
        { name: 'Chaat', qty: 1, unitPrice: 40 },
      ],
      amount: 90,
      currency: 'INR',
      status: 'KHATA',
      mode: 'KHATA',
      customerId: sunita._id,
      createdAt: new Date(now.getTime() - 180 * 60 * 1000),
    });
  }

  // 3. Group Order ready for Split ÷2 (2 Lassi, 2 Chaat = ₹180)
  freshTabs.push({
    number: nextNum++,
    items: [
      { name: 'Lassi', qty: 2, unitPrice: 50 },
      { name: 'Chaat', qty: 2, unitPrice: 40 },
    ],
    amount: 180,
    currency: 'INR',
    status: 'OPEN',
    mode: 'PAY_NOW',
    alertAfterSeconds: 45,
    createdAt: new Date(now.getTime() - 10 * 1000),
  });

  // 4. Primary Demo Order (2 Chaat, 1 Chai = ₹100) created right now
  freshTabs.push({
    number: nextNum++,
    items: [
      { name: 'Chaat', qty: 2, unitPrice: 40 },
      { name: 'Chai', qty: 1, unitPrice: 20 },
    ],
    amount: 100,
    currency: 'INR',
    status: 'OPEN',
    mode: 'PAY_NOW',
    alertAfterSeconds: 30,
    createdAt: now,
  });

  const created = await Tab.insertMany(freshTabs);
  return { createdCount: created.length };
}
