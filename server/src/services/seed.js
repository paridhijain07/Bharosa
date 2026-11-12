import crypto from 'crypto';
import { Vendor, Customer, Tab, Message, Reminder, CustomerPromise } from '../models/index.js';

export const DEFAULT_MENU = [
  { name: 'Chaat', emoji: '🍲', aliases: ['chaat', 'chat', 'samosa chaat', 'aloo chaat', 'चाट'], price: 40 },
  { name: 'Chai', emoji: '☕', aliases: ['chai', 'tea', 'masala chai', 'cutting', 'चाय'], price: 20 },
  { name: 'Samosa', emoji: '🥟', aliases: ['samosa', 'samoosa', 'समोसा'], price: 15 },
  { name: 'Lassi', emoji: '🥛', aliases: ['lassi', 'sweet lassi', 'लस्सी'], price: 50 },
  { name: 'Vada Pav', emoji: '🍔', aliases: ['vada pav', 'wada pav', 'vadapav', 'वड़ा पाव'], price: 25 },
  { name: 'Kachori', emoji: '🍘', aliases: ['kachori', 'kasta kachori', 'कचौड़ी'], price: 30 },
];

export const DEFAULT_CUSTOMERS = [
  { name: 'Raju', phone: '+919876543210', whatsappConsent: true, creditLimit: 300, isDemoSeeded: false },
  { name: 'Sunita', phone: '+919876543211', whatsappConsent: true, creditLimit: 400, isDemoSeeded: false },
  { name: 'Amit', phone: '+919876543212', whatsappConsent: true, creditLimit: 300, isDemoSeeded: false },
];

export async function ensureSeedData() {
  let vendor = await Vendor.findOne();
  if (!vendor) {
    vendor = await Vendor.create({
      name: 'Sharma Ji Chaat & Chai Stall',
      language: 'hi',
      shareToken: crypto.randomBytes(16).toString('hex'),
      isDemoSeeded: false,
      adaptiveAlertsEnabled: true,
      menu: DEFAULT_MENU,
    });
  } else {
    let changed = false;
    if (!vendor.shareToken) {
      vendor.shareToken = crypto.randomBytes(16).toString('hex'),
      changed = true;
    }
    if (vendor.isDemoSeeded) {
      vendor.isDemoSeeded = false;
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
  if (customerCount === 0) {
    await Customer.insertMany(DEFAULT_CUSTOMERS);
  } else {
    await Customer.updateMany({ isDemoSeeded: true }, { $set: { isDemoSeeded: false } });
  }

  await Tab.updateMany({ currency: 'USD' }, { $set: { currency: 'INR' } });
  return vendor;
}

/**
 * Wipes all pre-seeded/old orders, messages, promises, and reminders so the stall
 * starts 100% clean and unseeded (Order #1, ₹0 Collected/Pending/Khata) for live pitch recording.
 */
export async function cleanSlateForRecording() {
  await ensureSeedData();
  await Promise.all([
    Tab.deleteMany({}),
    Message.deleteMany({}),
    Reminder.deleteMany({}),
    CustomerPromise.deleteMany({}),
    Customer.updateMany(
      {},
      { $set: { isDemoSeeded: false, collectorStatus: 'NONE', collectorNote: '' } }
    ),
    Vendor.updateMany({}, { $set: { isDemoSeeded: false } }),
  ]);
  return { cleaned: true };
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
