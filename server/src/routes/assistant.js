import express from 'express';
import { z } from 'zod';
import { Tab, Customer } from '../models/index.js';
import { computeTodayStats } from './stats.js';

const router = express.Router();

export const AssistantAskInputSchema = z.object({
  text: z.string().min(1),
  lang: z.enum(['hi', 'en']).default('hi'),
});

export const AssistantIntentSchema = z.object({
  intent: z.enum([
    'TODAY_TOTAL',
    'PENDING_TABS',
    'KHATA_LIST',
    'KHATA_CUSTOMER',
    'BUSIEST_HOUR',
    'UNKNOWN',
  ]),
  customerName: z.string().nullable().optional(),
});

function isLlmConfigured() {
  const key = process.env.LLM_API_KEY;
  return Boolean(key) && !key.startsWith('your_');
}

/**
 * Deterministic keyword intent classifier (used as fallback or primary when LLM is not configured/mocked)
 */
export function classifyAssistantIntentByKeywords(text, knownCustomerNames = []) {
  const raw = String(text || '').trim();
  const lower = raw.toLowerCase();

  // Check if a known customer name is mentioned along with khata/udhaar/kitna/owes/balance
  for (const name of knownCustomerNames) {
    if (lower.includes(name.toLowerCase())) {
      return { intent: 'KHATA_CUSTOMER', customerName: name };
    }
  }

  // Also check "<Name> ka kitna" or "how much does <Name> owe"
  const custMatch =
    raw.match(/([a-zA-Z]+)\s+(?:ka|ke|ki)\s+(?:kitna|khata|udhaar|udhar|baki|baaki)/i) ||
    raw.match(/how\s+much\s+does\s+([a-zA-Z]+)\s+owe/i);
  if (custMatch) {
    const capName =
      custMatch[1].charAt(0).toUpperCase() + custMatch[1].slice(1).toLowerCase();
    const stopWords = new Set(['aaj', 'abhi', 'total', 'kaun', 'kiska', 'sab']);
    if (!stopWords.has(capName.toLowerCase())) {
      return { intent: 'KHATA_CUSTOMER', customerName: capName };
    }
  }

  // 1. BUSIEST_HOUR
  if (
    /\b(busiest|busy|rush|peak|kab bheed|kis time|konsa time|sabse zyada|भीड़|पीक|व्यस्त)\b/i.test(
      lower
    )
  ) {
    return { intent: 'BUSIEST_HOUR', customerName: null };
  }

  // 2. KHATA_LIST
  if (
    /\b(kaun kaun|kiska|khata|udhaar|udhar|credit|owed|owes|खाता|उधार|किसका|कौन)\b/i.test(
      lower
    )
  ) {
    return { intent: 'KHATA_LIST', customerName: null };
  }

  // 3. PENDING_TABS
  if (
    /\b(pending|unpaid|open|baki|baaki|ruka|nahi aaya|alert|बाकी|अनपेड|पेंडिंग|खुले)\b/i.test(
      lower
    )
  ) {
    return { intent: 'PENDING_TABS', customerName: null };
  }

  // 4. TODAY_TOTAL
  if (
    /\b(aaj|kitna aaya|kamai|collected|total|earned|earning|income|sale|sales|आज|कितना आया|कमाई|कुल)\b/i.test(
      lower
    )
  ) {
    return { intent: 'TODAY_TOTAL', customerName: null };
  }

  return { intent: 'UNKNOWN', customerName: null };
}

/**
 * Classify vendor question into one of the fixed intents using LLM (with 1x retry + Zod validation)
 * and fallback to deterministic keyword classification.
 */
export async function classifyAssistantIntent(text, knownCustomerNames = [], customLlmClassifier = null) {
  if (typeof customLlmClassifier === 'function') {
    try {
      const res = await customLlmClassifier(text, knownCustomerNames);
      return AssistantIntentSchema.parse(res);
    } catch {
      return classifyAssistantIntentByKeywords(text, knownCustomerNames);
    }
  }

  if (isLlmConfigured()) {
    const apiKey = process.env.LLM_API_KEY;
    const model = process.env.LLM_MODEL || 'gemini-2.5-flash';
    const systemPrompt = `You classify a street vendor's spoken question into ONE intent:
- TODAY_TOTAL: asking how much money was collected/earned today ("aaj kitna aaya?", "today's total")
- PENDING_TABS: asking how much is currently unpaid/pending on open tabs ("how much is pending?", "kitna baki hai abhi?")
- KHATA_LIST: asking who owes money on credit/khata ("kaun kaun udhaar mein hai?", "who is on khata?")
- KHATA_CUSTOMER: asking about a specific customer's khata balance ("Raju ka kitna baki hai?", "how much does Raju owe?")
- BUSIEST_HOUR: asking when the stall was busiest today ("when was rush hour?", "sabse zyada bheed kab thi?")
- UNKNOWN: anything else.
Known customers: ${knownCustomerNames.join(', ') || 'Raju, Sunita, Amit'}.
Return ONLY JSON: { "intent": "...", "customerName": string | null }`;

    const callOnce = async (hint = '') => {
      if (model.toLowerCase().includes('gemini')) {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: `${systemPrompt}\nQuestion: "${text}"\n${hint}` }] }],
            generationConfig: { responseMimeType: 'application/json', temperature: 0 },
          }),
        });
        if (!res.ok) throw new Error(`Gemini status ${res.status}`);
        const d = await res.json();
        const raw = d?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return AssistantIntentSchema.parse(JSON.parse(raw));
      }
      throw new Error('Fallback to keyword classifier');
    };

    try {
      return await callOnce();
    } catch {
      try {
        return await callOnce('Ensure valid JSON matching the schema.');
      } catch {
        // Fall through to deterministic classifier
      }
    }
  }

  return AssistantIntentSchema.parse(
    classifyAssistantIntentByKeywords(text, knownCustomerNames)
  );
}

/**
 * Deterministically compute the answer from MongoDB and phrase it into one short spoken sentence.
 * NEVER lets the LLM invent numbers.
 */
export async function answerAssistantIntent({ intent, customerName, lang = 'hi' }) {
  const currency = process.env.CURRENCY_SYMBOL || '₹';

  if (intent === 'TODAY_TOTAL') {
    const stats = await computeTodayStats();
    const data = {
      collected: stats.collected,
      paypalConfirmed: stats.paypalConfirmedToday,
      cashRecorded: stats.cashRecordedToday,
      paidOrders: stats.paidOrdersToday,
      currency,
    };
    const spokenText =
      lang === 'hi'
        ? `आज ${stats.paidOrdersToday} ऑर्डर से कुल ${currency}${stats.collected} आए हैं (${currency}${stats.paypalConfirmedToday} PayPal और ${currency}${stats.cashRecordedToday} कैश)।`
        : `Today you collected ${currency}${stats.collected} across ${stats.paidOrdersToday} orders (${currency}${stats.paypalConfirmedToday} PayPal verified, ${currency}${stats.cashRecordedToday} cash).`;
    return { intent, data, spokenText };
  }

  if (intent === 'PENDING_TABS') {
    const stats = await computeTodayStats();
    const data = {
      pending: stats.pending,
      openCount: stats.openCount,
      alertedCount: stats.alertedCount,
      currency,
    };
    const spokenText =
      stats.openCount === 0
        ? lang === 'hi'
          ? 'अभी कोई ऑर्डर बाकी नहीं है। सब पेमेंट हो चुका है।'
          : 'No pending orders right now. All tabs are paid.'
        : lang === 'hi'
          ? `अभी ${stats.openCount} खुले ऑर्डर में ${currency}${stats.pending} बाकी हैं, जिनमें ${stats.alertedCount} अलर्ट पर हैं।`
          : `There is ${currency}${stats.pending} pending across ${stats.openCount} open orders, with ${stats.alertedCount} alerting.`;
    return { intent, data, spokenText };
  }

  if (intent === 'KHATA_LIST') {
    const customers = await Customer.find();
    const khataTabs = await Tab.find({ status: 'KHATA' });

    const list = customers
      .map((c) => {
        const owed = khataTabs
          .filter((t) => String(t.customerId) === String(c._id))
          .reduce((s, t) => s + (Number(t.amount) || 0), 0);
        return { name: c.name, amount: owed };
      })
      .filter((item) => item.amount > 0);

    const totalKhata = list.reduce((s, i) => s + i.amount, 0);
    const data = { totalKhata, customers: list, currency };

    if (list.length === 0) {
      return {
        intent,
        data,
        spokenText:
          lang === 'hi'
            ? 'अभी किसी का खाता उधार बाकी नहीं है।'
            : 'No one owes money on khata right now.',
      };
    }

    const breakdownHi = list.map((i) => `${i.name} पर ${currency}${i.amount}`).join(', ');
    const breakdownEn = list.map((i) => `${i.name} owes ${currency}${i.amount}`).join(', ');
    const spokenText =
      lang === 'hi'
        ? `खाते में कुल ${currency}${totalKhata} बाकी हैं: ${breakdownHi}।`
        : `Total khata is ${currency}${totalKhata}: ${breakdownEn}.`;

    return { intent, data, spokenText };
  }

  if (intent === 'KHATA_CUSTOMER') {
    const targetName = (customerName || '').trim();
    const customer = targetName
      ? await Customer.findOne({ name: new RegExp(`^${targetName}$`, 'i') })
      : null;

    if (!customer) {
      const data = { customerName: targetName || null, amount: 0, found: false, currency };
      const spokenText =
        lang === 'hi'
          ? `${targetName || 'इस ग्राहक'} का नाम खाते में नहीं मिला।`
          : `Could not find ${targetName || 'that customer'} in the khata register.`;
      return { intent, data, spokenText };
    }

    const tabs = await Tab.find({ customerId: customer._id, status: 'KHATA' });
    const amount = tabs.reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const data = {
      customerName: customer.name,
      amount,
      tabCount: tabs.length,
      found: true,
      currency,
    };

    const spokenText =
      amount > 0
        ? lang === 'hi'
          ? `${customer.name} के खाते में ${currency}${amount} बाकी हैं।`
          : `${customer.name} owes ${currency}${amount} on khata.`
        : lang === 'hi'
          ? `${customer.name} का कोई उधार बाकी नहीं है।`
          : `${customer.name} has no pending khata balance.`;

    return { intent, data, spokenText };
  }

  if (intent === 'BUSIEST_HOUR') {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayTabs = await Tab.find({ createdAt: { $gte: startOfToday } });

    if (todayTabs.length === 0) {
      return {
        intent,
        data: { busiestHour: null, orderCount: 0 },
        spokenText:
          lang === 'hi'
            ? 'आज अभी तक कोई ऑर्डर दर्ज नहीं हुआ है।'
            : 'No orders have been recorded today yet.',
      };
    }

    const hourBuckets = {};
    for (const t of todayTabs) {
      const hr = new Date(t.createdAt).getHours();
      hourBuckets[hr] = (hourBuckets[hr] || 0) + 1;
    }

    let bestHour = 0;
    let maxOrders = 0;
    for (const [hrStr, count] of Object.entries(hourBuckets)) {
      if (count > maxOrders) {
        maxOrders = count;
        bestHour = Number(hrStr);
      }
    }

    const formatHour = (h) => {
      const suffix = h >= 12 ? 'PM' : 'AM';
      const hr12 = h % 12 === 0 ? 12 : h % 12;
      return `${hr12} ${suffix}`;
    };

    const hourLabel = formatHour(bestHour);
    const data = { busiestHour: bestHour, hourLabel, orderCount: maxOrders };
    const spokenText =
      lang === 'hi'
        ? `आज सबसे ज़्यादा भीड़ ${hourLabel} बजे थी, जब ${maxOrders} ऑर्डर आए।`
        : `Your busiest hour today was around ${hourLabel} with ${maxOrders} orders.`;

    return { intent, data, spokenText };
  }

  // UNKNOWN intent
  return {
    intent: 'UNKNOWN',
    data: {},
    spokenText:
      lang === 'hi'
        ? 'मैं आज की कमाई, बाकी ऑर्डर और खाते के हिसाब में मदद कर सकता हूँ।'
        : "I can help with today's total, pending orders, and khata.",
  };
}

/**
 * POST /api/assistant/ask
 * Body: { text, lang }
 */
router.post('/ask', async (req, res) => {
  try {
    const parsed = AssistantAskInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Question text is required' });
    }

    const { text, lang } = parsed.data;
    const customers = await Customer.find();
    const knownNames = customers.map((c) => c.name);

    const classification = await classifyAssistantIntent(text, knownNames);
    const responsePayload = await answerAssistantIntent({
      intent: classification.intent,
      customerName: classification.customerName,
      lang,
    });

    return res.json(responsePayload);
  } catch (err) {
    console.error('[POST /api/assistant/ask] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;

