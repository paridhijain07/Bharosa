import { z } from 'zod';

/**
 * Schema for 7.1 Listener (voice text -> tab)
 * Extended in Round 2 (Part B3) with `usual: boolean` for "Raju ka roz wala" / "Raju's usual".
 */
export const ParsedOrderSchema = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      qty: z.number().int().min(1),
      unitPrice: z.number().min(0).optional(),
      unmatched: z.boolean().optional(),
    })
  ),
  customerName: z.string().nullable().optional(),
  mode: z.enum(['PAY_NOW', 'KHATA']).default('PAY_NOW'),
  usual: z.boolean().optional().default(false),
  confidence: z.number().min(0).max(1),
  needsConfirmation: z.boolean().optional(),
  reason: z.string().optional(),
});

/**
 * Schema for 7.2 Collector (credit reminders)
 */
export const CollectorDecisionSchema = z.object({
  send: z.boolean(),
  tone: z.enum(['gentle', 'firm']),
  message: z.string(),
});

const HINDI_NUMERALS = {
  ek: 1,
  एक: 1,
  one: 1,
  '1': 1,
  do: 2,
  दो: 2,
  two: 2,
  '2': 2,
  teen: 3,
  तीन: 3,
  three: 3,
  '3': 3,
  chaar: 4,
  char: 4,
  चार: 4,
  four: 4,
  '4': 4,
  paanch: 5,
  panch: 5,
  पांच: 5,
  five: 5,
  '5': 5,
  chhe: 6,
  che: 6,
  छह: 6,
  six: 6,
  '6': 6,
  saat: 7,
  सात: 7,
  seven: 7,
  '7': 7,
  aath: 8,
  आठ: 8,
  eight: 8,
  '8': 8,
  nau: 9,
  नौ: 9,
  nine: 9,
  '9': 9,
  das: 10,
  दस: 10,
  ten: 10,
  '10': 10,
  aadha: 1,
};

function isLlmConfigured() {
  const key = process.env.LLM_API_KEY;
  return Boolean(key) && !key.startsWith('your_');
}

/**
 * Provider-agnostic JSON LLM caller (supports Gemini API and OpenAI-compatible APIs)
 * Retries once on invalid JSON or schema failure.
 */
async function callLlmJson({ systemPrompt, userPrompt, schema }) {
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || 'gemini-2.5-flash';

  const invokeOnce = async (retryHint = '') => {
    const fullPrompt = `${systemPrompt}\n\n${userPrompt}${retryHint ? `\n\nIMPORTANT: ${retryHint}` : ''}\nRespond ONLY with valid JSON.`;

    let rawText = '';
    if (model.toLowerCase().includes('gemini')) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: fullPrompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1,
          },
        }),
      });
      if (!res.ok) {
        throw new Error(`Gemini API error (${res.status})`);
      }
      const data = await res.json();
      rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } else {
      const baseUrl = process.env.LLM_BASE_URL || 'https://api.openai.com/v1';
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt + ' Respond ONLY with valid JSON.' },
            { role: 'user', content: userPrompt + (retryHint ? `\n${retryHint}` : '') },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
        }),
      });
      if (!res.ok) {
        throw new Error(`LLM API error (${res.status})`);
      }
      const data = await res.json();
      rawText = data?.choices?.[0]?.message?.content || '';
    }

    const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
    const parsed = JSON.parse(cleaned);
    return schema.parse(parsed);
  };

  try {
    return await invokeOnce();
  } catch (firstErr) {
    return await invokeOnce(
      `Your previous output failed validation (${firstErr.message}). Return strictly valid JSON matching the required schema.`
    );
  }
}

/**
 * Part B3: Deterministic resolver for "The usual" ("Raju ka roz wala", "Raju's usual", "same as yesterday for Raju").
 * Finds the customer's most frequent exact item combination over their last `limit` (default 10) tabs;
 * tie-breaks by most recent tab. Always assigns current prices from `menu`.
 */
export function resolveUsualOrderFromTabs(recentTabs = [], menu = [], customerName = 'Customer') {
  if (!recentTabs || recentTabs.length === 0) {
    return {
      found: false,
      items: [],
      amount: 0,
      needsConfirmation: true,
      reason: `No usual order found for ${customerName}`,
    };
  }

  // Group by canonical item combination signature (sorted by name:qty)
  const comboMap = new Map();

  recentTabs.forEach((tab, index) => {
    const rawItems = tab.items || [];
    if (rawItems.length === 0) return;

    const normalized = rawItems
      .map((i) => ({ name: String(i.name).trim(), qty: Number(i.qty) || 1 }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const key = normalized.map((i) => `${i.name.toLowerCase()}:${i.qty}`).join('|');
    const existing = comboMap.get(key);
    const tabTime = tab.createdAt ? new Date(tab.createdAt).getTime() : -index;

    if (!existing) {
      comboMap.set(key, {
        count: 1,
        latestTime: tabTime,
        firstSeenIndex: index,
        items: normalized,
      });
    } else {
      existing.count += 1;
      if (tabTime > existing.latestTime) {
        existing.latestTime = tabTime;
      }
    }
  });

  if (comboMap.size === 0) {
    return {
      found: false,
      items: [],
      amount: 0,
      needsConfirmation: true,
      reason: `No usual order found for ${customerName}`,
    };
  }

  // Pick highest count; tie-break by most recent (`latestTime` descending, then `firstSeenIndex` ascending)
  const sortedCombos = Array.from(comboMap.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    if (b.latestTime !== a.latestTime) return b.latestTime - a.latestTime;
    return a.firstSeenIndex - b.firstSeenIndex;
  });

  const bestCombo = sortedCombos[0];
  const enrichedItems = bestCombo.items.map((item) => {
    const menuMatch = menu.find(
      (m) =>
        m.name.toLowerCase() === item.name.toLowerCase() ||
        (m.aliases || []).some((a) => a.toLowerCase() === item.name.toLowerCase())
    );
    return {
      name: menuMatch ? menuMatch.name : item.name,
      qty: item.qty,
      unitPrice: menuMatch ? Number(menuMatch.price) : 0,
      unmatched: !menuMatch,
    };
  });

  const amount = enrichedItems.reduce((sum, i) => sum + i.qty * (i.unitPrice || 0), 0);

  return {
    found: true,
    items: enrichedItems,
    amount,
    frequencyCount: bestCombo.count,
    needsConfirmation: enrichedItems.some((i) => i.unmatched),
  };
}

/**
 * Deterministic Bilingual Hinglish/Hindi/English Parser
 * Ensures prices are ALWAYS taken strictly from the vendor's menu.
 */
export function deterministicParseOrder(text, menu = [], knownCustomers = []) {
  const raw = String(text || '').trim();
  if (!raw) {
    return {
      items: [],
      amount: 0,
      customerName: null,
      mode: 'PAY_NOW',
      usual: false,
      confidence: 0,
      needsConfirmation: true,
      reason: 'Empty voice transcript',
    };
  }

  const lower = raw.toLowerCase();

  // Detect KHATA mode keywords
  const khataRegex = /\b(khata|khate|udhaar|udhar|credit|account|खाता|उधार)\b/i;
  const isKhata = khataRegex.test(lower);

  // Detect "usual" keywords ("roz wala", "usual", "same as yesterday", "hamesha wala", "daily wala")
  const usualRegex =
    /\b(roz\s*wala|roj\s*wala|usual|same\s+as\s+yesterday|hamesha\s*wala|daily\s*wala|रोज़\s*वाला|रोज\s*वाला|हमेशा\s*वाला)\b/i;
  const isUsual = usualRegex.test(lower);

  const mode = isKhata ? 'KHATA' : 'PAY_NOW';

  // Extract customer name
  let customerName = null;
  for (const c of knownCustomers) {
    if (lower.includes(c.name.toLowerCase())) {
      customerName = c.name;
      break;
    }
  }
  if (!customerName && (isKhata || isUsual)) {
    const kaMatch =
      raw.match(/([a-zA-Z]+)\s+(?:ka|ke|ki)\s+(?:khata|udhaar|udhar|roz|roj|usual|hamesha)/i) ||
      raw.match(/([a-zA-Z]+)'s\s+usual/i) ||
      raw.match(/for\s+([a-zA-Z]+)\b/i) ||
      raw.match(/^([A-Z][a-z]+)\b/);
    if (kaMatch && !HINDI_NUMERALS[kaMatch[1].toLowerCase()]) {
      const candidate = kaMatch[1];
      const reserved = new Set(['same', 'usual', 'khata', 'order']);
      if (!reserved.has(candidate.toLowerCase())) {
        customerName = candidate.charAt(0).toUpperCase() + candidate.slice(1).toLowerCase();
      }
    }
  }

  if (isUsual) {
    return {
      items: [],
      amount: 0,
      customerName,
      mode,
      usual: true,
      confidence: customerName ? 0.95 : 0.65,
      needsConfirmation: !customerName,
      reason: customerName ? undefined : 'Customer name needed for usual order',
    };
  }

  // Match menu items and quantities
  const matchedItems = [];
  const tokens = lower
    .replace(/[.,!?]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  for (const menuItem of menu) {
    const allNames = [
      menuItem.name.toLowerCase(),
      ...(menuItem.aliases || []).map((a) => a.toLowerCase()),
    ];
    allNames.sort((a, b) => b.length - a.length);

    for (const alias of allNames) {
      const aliasIdx = lower.indexOf(alias);
      if (aliasIdx !== -1) {
        if (matchedItems.some((m) => m.name === menuItem.name)) break;

        const beforeText = lower.slice(0, aliasIdx).trim();
        const beforeTokens = beforeText.split(/\s+/).filter(Boolean);
        const prevWord = beforeTokens[beforeTokens.length - 1];

        let qty = 1;
        if (prevWord && HINDI_NUMERALS[prevWord] !== undefined) {
          qty = HINDI_NUMERALS[prevWord];
        } else if (prevWord && /^\d+$/.test(prevWord)) {
          qty = parseInt(prevWord, 10);
        }

        matchedItems.push({
          name: menuItem.name,
          qty,
          unitPrice: menuItem.price,
          unmatched: false,
        });
        break;
      }
    }
  }

  // Check if the user mentioned an item not on the menu
  const stopWords = new Set([
    ...Object.keys(HINDI_NUMERALS),
    'aur',
    'and',
    'or',
    'ka',
    'ki',
    'ke',
    'khata',
    'khate',
    'udhaar',
    'udhar',
    'credit',
    'bhai',
    'ji',
    'plate',
    'cup',
    'glass',
    'order',
    'de',
    'do',
    'dena',
    'lagao',
    ...(customerName ? [customerName.toLowerCase()] : []),
  ]);

  const matchedWords = new Set();
  for (const item of matchedItems) {
    const menuEntry = menu.find((m) => m.name === item.name);
    if (menuEntry) {
      matchedWords.add(menuEntry.name.toLowerCase());
      for (const a of menuEntry.aliases || []) {
        a.toLowerCase()
          .split(/\s+/)
          .forEach((w) => matchedWords.add(w));
      }
    }
  }

  const unknownWords = tokens.filter(
    (w) => !stopWords.has(w) && !matchedWords.has(w) && !/^\d+$/.test(w) && w.length > 2
  );

  let confidence = matchedItems.length > 0 ? 0.92 : 0.2;
  if (unknownWords.length > 0) {
    confidence = matchedItems.length > 0 ? 0.55 : 0.2;
    for (const unk of unknownWords) {
      matchedItems.push({
        name: unk.charAt(0).toUpperCase() + unk.slice(1),
        qty: 1,
        unitPrice: 0,
        unmatched: true,
      });
    }
  }

  const amount = matchedItems.reduce((sum, it) => sum + it.qty * (it.unitPrice || 0), 0);
  const needsConfirmation =
    confidence < 0.6 || matchedItems.length === 0 || matchedItems.some((i) => i.unmatched);

  return {
    items: matchedItems,
    amount,
    customerName,
    mode,
    usual: false,
    confidence,
    needsConfirmation,
    reason: unknownWords.length > 0 ? 'Not on menu' : needsConfirmation ? 'Not sure' : undefined,
  };
}

/**
 * 7.1 Listener: Parse spoken transcript into structured Tab JSON
 * Enforces menu prices and Zod validation.
 */
export async function parseVoiceOrder(text, menu = [], knownCustomers = []) {
  const raw = String(text || '').trim();
  if (!raw) {
    return deterministicParseOrder('', menu, knownCustomers);
  }

  // First check if deterministic parser detects a "usual" phrase so it works reliably with or without LLM
  const detCheck = deterministicParseOrder(raw, menu, knownCustomers);
  if (detCheck.usual) {
    ParsedOrderSchema.parse(detCheck);
    return detCheck;
  }

  if (isLlmConfigured()) {
    try {
      const menuDescription = menu
        .map((m) => `- ${m.name} (aliases: ${(m.aliases || []).join(', ')}): price ${m.price}`)
        .join('\n');
      const customerNames = knownCustomers.map((c) => c.name).join(', ');

      const systemPrompt = `You are Bharosa's Listener AI for an Indian street food stall.
Parse the vendor's spoken order (often mixed Hindi, Hinglish, or English) into JSON:
{
  "items": [{ "name": "<canonical menu name or spoken name>", "qty": <integer> }],
  "customerName": "<string or null>",
  "mode": "PAY_NOW" | "KHATA",
  "usual": <boolean>,
  "confidence": <number 0.0 to 1.0>
}
Rules:
1. Understand Hindi numerals ("ek"=1, "do"=2, "teen"=3, "chaar"=4, "paanch"=5, etc.) and Hinglish.
2. Match items against the vendor's menu below. Never invent prices.
3. Detect "khata", "udhaar", "credit" as mode="KHATA" and extract the customerName (e.g. "Raju").
4. Detect "roz wala", "usual", "same as yesterday" as usual=true and extract customerName.
5. If an item is not on the menu or transcript is unclear, set confidence < 0.5.

Vendor Menu:
${menuDescription}
Known Regular Customers: ${customerNames || 'Raju, Sunita'}`;

      const llmRes = await callLlmJson({
        systemPrompt,
        userPrompt: `Spoken transcript: "${raw}"`,
        schema: ParsedOrderSchema,
      });

      if (llmRes.usual) {
        return {
          items: [],
          amount: 0,
          customerName: llmRes.customerName || detCheck.customerName || null,
          mode: llmRes.mode,
          usual: true,
          confidence: llmRes.confidence,
          needsConfirmation: false,
        };
      }

      const enrichedItems = llmRes.items.map((item) => {
        const lowerName = item.name.toLowerCase();
        const found = menu.find(
          (m) =>
            m.name.toLowerCase() === lowerName ||
            (m.aliases || []).some((a) => a.toLowerCase() === lowerName)
        );
        if (found) {
          return {
            name: found.name,
            qty: item.qty,
            unitPrice: found.price,
            unmatched: false,
          };
        }
        return {
          name: item.name,
          qty: item.qty,
          unitPrice: 0,
          unmatched: true,
        };
      });

      const hasUnmatched = enrichedItems.some((i) => i.unmatched);
      const confidence = hasUnmatched ? Math.min(llmRes.confidence, 0.5) : llmRes.confidence;
      const amount = enrichedItems.reduce((sum, i) => sum + i.qty * i.unitPrice, 0);
      const needsConfirmation =
        confidence < 0.6 || hasUnmatched || enrichedItems.length === 0;

      const validated = ParsedOrderSchema.parse({
        items: enrichedItems,
        customerName: llmRes.customerName || null,
        mode: llmRes.mode,
        usual: false,
        confidence,
        needsConfirmation,
        reason: hasUnmatched ? 'Not on menu' : needsConfirmation ? 'Not sure' : undefined,
      });

      return {
        ...validated,
        amount,
      };
    } catch (err) {
      console.warn('[LLM] Falling back to deterministic parser:', err.message);
    }
  }

  ParsedOrderSchema.parse(detCheck);
  return detCheck;
}

/**
 * 7.2 Collector: Decide whether & how to send a WhatsApp credit reminder
 */
export async function generateCollectorReminder({
  customer,
  tab,
  attempt,
  daysSinceCredit,
  payLink,
  language = 'hi',
  currencySymbol = '₹',
}) {
  if (!customer?.whatsappConsent) {
    return {
      send: false,
      tone: 'gentle',
      message: 'Skipped: Customer has not provided WhatsApp consent.',
    };
  }

  const tone = attempt <= 1 ? 'gentle' : 'firm';
  const itemsSummary = (tab.items || []).map((i) => `${i.qty}x ${i.name}`).join(', ');
  const amountStr = `${currencySymbol}${tab.amount}`;

  const fallbackMessage =
    language === 'hi'
      ? tone === 'gentle'
        ? `नमस्ते ${customer.name} जी! 🙏 शर्मा जी चाट स्टॉल से याद दिला रहे हैं — आपका ${itemsSummary} का ${amountStr} खाता बाकी है। जब सुविधा हो, इस PayPal लिंक से पेमेंट कर दें: ${payLink}`
        : `नमस्ते ${customer.name} जी, आपका ${amountStr} (${itemsSummary}) का खाता ${daysSinceCredit} दिन से बाकी है। कृपया आज इस PayPal लिंक से पेमेंट पूरा करें: ${payLink} धन्यवाद!`
      : tone === 'gentle'
        ? `Hi ${customer.name}! Friendly reminder from Sharma Ji Stall for your tab of ${amountStr} (${itemsSummary}). You can pay securely with one tap via PayPal: ${payLink}`
        : `Hello ${customer.name}, a polite follow-up on your pending balance of ${amountStr} (${itemsSummary}). Please settle your tab today via PayPal: ${payLink}. Thank you!`;

  if (isLlmConfigured()) {
    try {
      const systemPrompt = `You are Bharosa's Collector AI helping a friendly street vendor recover credit (khata).
Generate JSON: { "send": boolean, "tone": "gentle" | "firm", "message": "<string>" }
Rules:
- Attempt 1: gentle, warm. Attempt 2+: firmer but ALWAYS polite and respectful. Never threatening or shaming.
- Language: ${language === 'hi' ? 'Conversational Hindi/Hinglish' : 'Polite English'}.
- Must include the amount (${amountStr}), items (${itemsSummary}), and the exact PayPal pay link (${payLink}).`;

      const userPrompt = `Customer: ${customer.name}, Attempt: ${attempt}, Days since credit: ${daysSinceCredit}, Consent: ${customer.whatsappConsent}`;
      return await callLlmJson({
        systemPrompt,
        userPrompt,
        schema: CollectorDecisionSchema,
      });
    } catch (err) {
      console.warn('[LLM Collector] Using deterministic template:', err.message);
    }
  }

  return CollectorDecisionSchema.parse({
    send: true,
    tone,
    message: fallbackMessage,
  });
}

/**
 * 7.3 Spoken summaries for Khata & End-of-Day
 */
export function buildSpokenKhataSummary({ customerName, amount, reminderCount, language = 'en' }) {
  if (language === 'hi') {
    return `${customerName} के ${amount} रुपये बाकी हैं, ${reminderCount} बार याद दिलाया गया।`;
  }
  const timesWord =
    reminderCount === 1 ? 'once' : reminderCount === 2 ? 'twice' : `${reminderCount} times`;
  return `${customerName} owes ${amount} rupees, reminded ${timesWord}, no reply.`;
}


/**
 * Round 3 (Part 1.3): Schema for Two-Way WhatsApp Customer Reply Understanding
 */
export const CustomerReplySchema = z.object({
  intent: z.enum([
    'PROMISE_DATE',
    'PARTIAL_NOW',
    'PAYING_NOW',
    'DISPUTE',
    'OPT_OUT',
    'QUESTION',
    'OTHER',
  ]),
  promiseDate: z.string().nullable().default(null),
  amount: z.number().min(0).default(0),
  language: z.enum(['hi', 'en']).default('hi'),
  confidence: z.number().min(0).max(1),
});

const WEEKDAY_MAP = {
  sunday: 0,
  raviwar: 0,
  itwar: 0,
  रविवार: 0,
  monday: 1,
  somwar: 1,
  सोमवार: 1,
  tuesday: 2,
  mangalwar: 2,
  मंगलवार: 2,
  wednesday: 3,
  budhwar: 3,
  बुधवार: 3,
  thursday: 4,
  guruwar: 4,
  brihaspatiwar: 4,
  गुरुवार: 4,
  friday: 5,
  shukrawar: 5,
  juma: 5,
  शुक्रवार: 5,
  saturday: 6,
  shaniwar: 6,
  शनिवार: 6,
};

function formatYmd(year, monthZeroIndexed, day) {
  const d = new Date(year, monthZeroIndexed, day, 12, 0, 0, 0);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dt = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dt}`;
}

/**
 * Resolve relative date expressions ("kal", "tomorrow", "parso", weekday names,
 * "agle hafte", "next week", or explicit YYYY-MM-DD) against `todayDateStr`.
 */
export function resolveRelativePromiseDate(text, todayDateStr) {
  const raw = String(text || '').toLowerCase();
  const baseStr =
    todayDateStr && /^\d{4}-\d{2}-\d{2}$/.test(todayDateStr)
      ? todayDateStr
      : formatYmd(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  const [y, m, d] = baseStr.split('-').map(Number);
  const baseDate = new Date(y, m - 1, d, 12, 0, 0, 0);

  // 1. Explicit YYYY-MM-DD in text
  const isoMatch = raw.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (isoMatch) {
    return isoMatch[1];
  }

  // 2. "parso" / "day after tomorrow" -> +2 days
  if (/\b(parso|parson|day\s+after\s+tomorrow|परसों)\b/i.test(raw)) {
    return formatYmd(y, m - 1, d + 2);
  }

  // 3. "kal" / "tomorrow" -> +1 day
  if (/\b(kal|tomorrow|tmrw|कल)\b/i.test(raw)) {
    return formatYmd(y, m - 1, d + 1);
  }

  // 4. "agle hafte" / "next week" -> +7 days
  if (/\b(agle\s+hafte|next\s+week|अगले\s+हफ़्ते|अगले\s+हफ्ते)\b/i.test(raw)) {
    return formatYmd(y, m - 1, d + 7);
  }

  // 5. "in N days" / "N din mein" / "N din baad"
  const daysMatch = raw.match(/\b(\d{1,2})\s*(?:din|days?)\b/i);
  if (daysMatch) {
    const offset = Number(daysMatch[1]);
    if (offset >= 1 && offset <= 30) {
      return formatYmd(y, m - 1, d + offset);
    }
  }

  // 6. Weekday name ("Friday", "shukrawar", etc.) -> next occurrence (1..7 days ahead)
  for (const [token, targetDow] of Object.entries(WEEKDAY_MAP)) {
    if (raw.includes(token)) {
      const currentDow = baseDate.getDay();
      let delta = (targetDow - currentDow + 7) % 7;
      if (delta === 0) delta = 7; // next occurrence in the future
      return formatYmd(y, m - 1, d + delta);
    }
  }

  return null;
}

/**
 * Server-side validation of `promiseDate` (must be strictly in the future and <= 30 days)
 * and `amount` (must be > 0 and <= outstandingAmount).
 */
export function validateAndSanitizeCustomerReply(parsed, { todayDateStr, outstandingAmount = 0 }) {
  const baseStr =
    todayDateStr && /^\d{4}-\d{2}-\d{2}$/.test(todayDateStr)
      ? todayDateStr
      : formatYmd(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  const [y, m, d] = baseStr.split('-').map(Number);
  const todayNoon = new Date(y, m - 1, d, 12, 0, 0, 0);

  let intent = parsed.intent || 'OTHER';
  let promiseDate = parsed.promiseDate || null;
  let amount = Number(parsed.amount) || 0;
  let confidence = Number(parsed.confidence) || 0;
  const language = parsed.language === 'en' ? 'en' : 'hi';

  // Validate amount: positive and not above outstandingAmount
  if (amount <= 0 || (outstandingAmount > 0 && amount > outstandingAmount)) {
    amount = 0;
  }

  // Validate promiseDate: must be YYYY-MM-DD, > today, and <= today + 30 days
  let validFutureDate = false;
  if (promiseDate && /^\d{4}-\d{2}-\d{2}$/.test(promiseDate)) {
    const [py, pm, pd] = promiseDate.split('-').map(Number);
    const pDate = new Date(py, pm - 1, pd, 12, 0, 0, 0);
    const diffDays = Math.round((pDate.getTime() - todayNoon.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays >= 1 && diffDays <= 30) {
      validFutureDate = true;
    } else {
      promiseDate = null;
    }
  } else {
    promiseDate = null;
  }

  // If intent is PROMISE_DATE but promiseDate is missing or invalid -> treat as OTHER (needs vendor)
  if (intent === 'PROMISE_DATE' && !validFutureDate) {
    intent = 'OTHER';
    confidence = Math.min(confidence, 0.45);
  }

  const needsVendor =
    confidence < 0.6 || intent === 'QUESTION' || intent === 'OTHER';

  return {
    intent,
    promiseDate,
    amount,
    language,
    confidence,
    needsVendor,
  };
}

/**
 * Deterministic Fallback Rules for `parseCustomerReply` (used when LLM is unavailable or fails).
 */
export function deterministicParseCustomerReply({
  text,
  todayDateStr,
  outstandingAmount = 0,
}) {
  const raw = String(text || '').trim();
  const lower = raw.toLowerCase();

  // Detect language: if mostly English words without Hindi tokens, use 'en', else 'hi'
  const hasDevanagari = /[\u0900-\u097F]/.test(raw);
  const hasHinglishTokens =
    /\b(kal|parso|abhi|aaj|de\s*dunga|dunga|de\s*raha|baaki|baki|nahi|galat|mera|band\s*karo|bhaiya|ji)\b/i.test(
      lower
    );
  const language = hasDevanagari || hasHinglishTokens ? 'hi' : 'en';

  if (!raw) {
    return validateAndSanitizeCustomerReply(
      { intent: 'OTHER', promiseDate: null, amount: 0, language, confidence: 0.2 },
      { todayDateStr, outstandingAmount }
    );
  }

  // 1. OPT_OUT ("stop", "unsubscribe", "band karo", "mat bhejo")
  if (
    /\b(stop|unsubscribe|opt\s*out|band\s*karo|mat\s*bhejo|message\s*mat\s*karo|बंद\s*करो|मत\s*भेजो)\b/i.test(
      lower
    )
  ) {
    return validateAndSanitizeCustomerReply(
      { intent: 'OPT_OUT', promiseDate: null, amount: 0, language, confidence: 0.95 },
      { todayDateStr, outstandingAmount }
    );
  }

  // 2. DISPUTE ("mera nahi tha", "wrong order", "galat hisab", "not my order", "maine nahi liya")
  if (
    /\b(mera\s*nahi|maine\s*nahi|galat|wrong\s*order|not\s*mine|not\s*my\s*order|dispute|fake|ये\s*मेरा\s*नहीं|गलत)\b/i.test(
      lower
    )
  ) {
    return validateAndSanitizeCustomerReply(
      { intent: 'DISPUTE', promiseDate: null, amount: 0, language, confidence: 0.92 },
      { todayDateStr, outstandingAmount }
    );
  }

  // 3. Extract any explicit number in the reply (ignoring 4-digit years like 2026)
  const numberMatches = [...lower.matchAll(/\b(\d{1,4})\b/g)]
    .map((m) => Number(m[1]))
    .filter((n) => n > 0 && n < 2020);
  const extractedAmount = numberMatches.length > 0 ? numberMatches[0] : 0;
  const resolvedDate = resolveRelativePromiseDate(raw, todayDateStr);

  // 4. Customer claims "already paid" ("de diya", "paid already", "bhej diya") -> OTHER / NEEDS_VENDOR (never mark paid from a claim!)
  if (
    /\b(already\s*paid|de\s*diya|pehle\s*hi\s*de\s*diya|kar\s*diya\s*था|paid\s*yesterday)\b/i.test(
      lower
    )
  ) {
    return validateAndSanitizeCustomerReply(
      { intent: 'OTHER', promiseDate: null, amount: 0, language, confidence: 0.5 },
      { todayDateStr, outstandingAmount }
    );
  }

  // 5. PARTIAL_NOW / PAYING_NOW ("abhi 100 de raha hoon", "paying 50 now", "abhi bhej raha hoon", "send link")
  const hasNowKeyword =
    /\b(abhi|aaj\s*hi|right\s*now|paying\s*now|de\s*raha|bhej\s*raha|sending\s*now|pay\s*now|अभी|दे\s*रहा)\b/i.test(
      lower
    );
  if (hasNowKeyword) {
    if (
      extractedAmount > 0 &&
      (outstandingAmount === 0 || extractedAmount < outstandingAmount)
    ) {
      return validateAndSanitizeCustomerReply(
        {
          intent: 'PARTIAL_NOW',
          promiseDate: resolvedDate,
          amount: extractedAmount,
          language,
          confidence: 0.9,
        },
        { todayDateStr, outstandingAmount }
      );
    }
    return validateAndSanitizeCustomerReply(
      {
        intent: 'PAYING_NOW',
        promiseDate: resolvedDate,
        amount: extractedAmount > 0 ? extractedAmount : outstandingAmount,
        language,
        confidence: 0.88,
      },
      { todayDateStr, outstandingAmount }
    );
  }

  // 6. PROMISE_DATE ("Friday ko de dunga", "kal de dunga", "will pay tomorrow")
  if (resolvedDate) {
    return validateAndSanitizeCustomerReply(
      {
        intent: 'PROMISE_DATE',
        promiseDate: resolvedDate,
        amount: extractedAmount > 0 ? extractedAmount : outstandingAmount,
        language,
        confidence: 0.9,
      },
      { todayDateStr, outstandingAmount }
    );
  }

  // 7. QUESTION ("kitna baki hai?", "kis din ka hai?", "how much?")
  if (/\?|kitna|kab\s*ka|kaunsa|how\s*much|which\s*order|कितना/i.test(lower)) {
    return validateAndSanitizeCustomerReply(
      { intent: 'QUESTION', promiseDate: null, amount: 0, language, confidence: 0.75 },
      { todayDateStr, outstandingAmount }
    );
  }

  // 8. Unclear -> OTHER with low confidence -> NEEDS_VENDOR
  return validateAndSanitizeCustomerReply(
    { intent: 'OTHER', promiseDate: null, amount: 0, language, confidence: 0.4 },
    { todayDateStr, outstandingAmount }
  );
}

/**
 * Round 3 (Part 1.3): Parse inbound customer WhatsApp reply using LLM (with 1 retry) + deterministic fallback.
 * Accepts optional `llmInvoker` for unit testing with a mocked LLM.
 */
export async function parseCustomerReply({
  text,
  todayDateStr,
  timezone = 'Asia/Kolkata',
  outstandingAmount = 0,
  lastReminderText = '',
  llmInvoker = null,
}) {
  const baseStr =
    todayDateStr && /^\d{4}-\d{2}-\d{2}$/.test(todayDateStr)
      ? todayDateStr
      : formatYmd(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());

  const invokeModel = llmInvoker || (isLlmConfigured() ? callLlmJson : null);

  if (invokeModel) {
    try {
      const systemPrompt = `You are Bharosa's Two-Way WhatsApp Collector AI for an Indian street vendor.
Understand the customer's reply (in Hindi, Hinglish, or English) to a khata reminder and output ONLY JSON matching:
{
  "intent": "PROMISE_DATE" | "PARTIAL_NOW" | "PAYING_NOW" | "DISPUTE" | "OPT_OUT" | "QUESTION" | "OTHER",
  "promiseDate": "YYYY-MM-DD or null",
  "amount": <number, 0 if not mentioned>,
  "language": "hi" | "en",
  "confidence": <number 0.0 to 1.0>
}
Rules:
1. Today's date is ${baseStr} (Timezone: ${timezone}). Resolve relative dates ("kal", "parso", "Friday ko", "agle hafte") to YYYY-MM-DD.
2. Customer's outstanding balance is ₹${outstandingAmount}. Last reminder sent: "${lastReminderText || 'none'}".
3. If customer says they are paying part of the balance right now (e.g. "abhi 100 de raha hoon baaki kal"), set intent="PARTIAL_NOW", amount=100, and promiseDate to the promised date for the rest if mentioned.
4. If customer promises to pay on a future date, set intent="PROMISE_DATE" and promiseDate="YYYY-MM-DD".
5. If customer says "I already paid", set intent="OTHER" and confidence=0.5 so the vendor checks manually.
6. If customer disputes the order ("mera nahi tha", "wrong order"), set intent="DISPUTE".
7. If customer asks to stop messages ("stop", "band karo"), set intent="OPT_OUT".`;

      const rawResult = await invokeModel({
        systemPrompt,
        userPrompt: `Customer reply: "${text}"`,
        schema: CustomerReplySchema,
      });

      const parsed = CustomerReplySchema.parse(rawResult);
      // If LLM missed resolving a relative date string, try deterministic date resolver
      if (!parsed.promiseDate) {
        const fallbackDate = resolveRelativePromiseDate(text, baseStr);
        if (fallbackDate && ['PROMISE_DATE', 'PARTIAL_NOW'].includes(parsed.intent)) {
          parsed.promiseDate = fallbackDate;
        }
      }
      return validateAndSanitizeCustomerReply(parsed, {
        todayDateStr: baseStr,
        outstandingAmount,
      });
    } catch (err) {
      console.warn('[parseCustomerReply] Falling back to deterministic rules:', err.message);
    }
  }

  return deterministicParseCustomerReply({
    text,
    todayDateStr: baseStr,
    outstandingAmount,
  });
}

/**
 * Round 3 (Part 1.5): Hard Guardrails Validator for Outbound Collector Replies.
 * Rejects any text containing threats, shaming, legal/police mentions, discounts/waivers,
 * unauthorized amount modifications, or excessive length.
 */
const FORBIDDEN_REPLY_PATTERNS = [
  /\b(police|court|legal|lawsuit|jail|arrest|fir|f\.i\.r|lawyer|advocate|thana|पुलिस|जेल|कोर्ट|कानूनी)\b/i,
  /\b(shame|ashamed|besharam|chor|thief|fraud|dhokha|cheater|beggars?|बेशर्म|चोर|धोखा)\b/i,
  /\b(threat|maar|warn|warning|consequences|punish|penalty|fine|interest\s+charge|जुर्माना|ब्याज|धमकी)\b/i,
  /\b(discount|waive|waiver|maaf|free\s+of\s+cost|concession|छूट|माफ़|माफ)\b/i,
  /\b(hospital|illness|disease|religion|caste|family\s+matter|बीमारी|अस्पताल)\b/i,
];

export function validateCollectorReplyGuardrails(
  text,
  { allowedAmounts = [], maxLen = 420 } = {}
) {
  const clean = String(text || '').trim();
  if (clean.length < 5 || clean.length > maxLen) {
    return { valid: false, reason: 'Length out of bounds' };
  }

  for (const regex of FORBIDDEN_REPLY_PATTERNS) {
    if (regex.test(clean)) {
      return { valid: false, reason: `Matched forbidden pattern: ${regex}` };
    }
  }

  // If allowedAmounts are provided, verify any rupee figure mentioned is in allowedAmounts
  if (allowedAmounts.length > 0) {
    const allowedSet = new Set(allowedAmounts.map((n) => Number(n)));
    const currencyMatches = [
      ...clean.matchAll(/(?:₹|rs\.?\s*|rupees\s*)(\d+(?:\.\d+)?)/gi),
      ...clean.matchAll(/(\d+(?:\.\d+)?)\s*(?:rupees|रुपये)/gi),
    ];
    for (const m of currencyMatches) {
      const val = Number(m[1]);
      if (Number.isFinite(val) && !allowedSet.has(val)) {
        return {
          valid: false,
          reason: `Unauthorized amount ₹${val} not in [${[...allowedSet].join(', ')}]`,
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Deterministic safe templates for every collector action (Part 1.5).
 */
export function buildSafeAutoReplyTemplate({
  action,
  customerName,
  language = 'hi',
  amount,
  remainingAmount,
  promiseDateFormatted,
  payLink,
  currencySymbol = '₹',
}) {
  const isHi = language !== 'en';
  const name = customerName || (isHi ? 'जी' : 'there');

  switch (action) {
    case 'PROMISE_DATE':
      return isHi
        ? `धन्यवाद ${name} जी! 🙏 हमने नोट कर लिया है कि आप ${promiseDateFormatted} को ${currencySymbol}${amount} का भुगतान करेंगे। सुविधा के लिए लिंक: ${payLink}`
        : `Thank you ${name}! 🙏 We have noted your promise to pay ${currencySymbol}${amount} on ${promiseDateFormatted}. Here is your PayPal link whenever you are ready: ${payLink}`;

    case 'PARTIAL_NOW':
      return isHi
        ? `धन्यवाद ${name} जी! अभी ${currencySymbol}${amount} पेमेंट करने के लिए यह PayPal लिंक इस्तेमाल करें: ${payLink}${
            remainingAmount > 0
              ? ` (बाकी ${currencySymbol}${remainingAmount}${
                  promiseDateFormatted ? ` ${promiseDateFormatted} को` : ''
                })`
              : ''
          }`
        : `Thank you ${name}! You can pay ${currencySymbol}${amount} now using this PayPal link: ${payLink}${
            remainingAmount > 0
              ? ` (remaining ${currencySymbol}${remainingAmount}${
                  promiseDateFormatted ? ` noted for ${promiseDateFormatted}` : ''
                })`
              : ''
          }.`;

    case 'PAYING_NOW':
      return isHi
        ? `धन्यवाद ${name} जी! ${currencySymbol}${amount} का भुगतान पूरा करने के लिए इस PayPal लिंक पर टैप करें: ${payLink}`
        : `Thank you ${name}! Please use this PayPal link to complete your payment of ${currencySymbol}${amount}: ${payLink}`;

    case 'DISPUTE':
      return isHi
        ? `नमस्ते ${name} जी, हमने आपका संदेश नोट कर लिया है। मैं दुकानदार (शर्मा जी) को अभी बता रहा हूँ।`
        : `Hello ${name}, I have noted your message and will let the stall owner know right away.`;

    case 'OPT_OUT':
      return isHi
        ? `ठीक है ${name} जी, हमने आपके नंबर पर WhatsApp रिमाइंडर बंद कर दिए हैं। धन्यवाद।`
        : `Understood ${name}, we have stopped WhatsApp reminders for your number. Thank you.`;

    case 'BROKEN_PROMISE_FOLLOWUP':
      return isHi
        ? `नमस्ते ${name} जी, आपने ${promiseDateFormatted} को ${currencySymbol}${amount} के खाते का भुगतान करने का वादा किया था। कृपया आज इस PayPal लिंक से पेमेंट पूरा करें: ${payLink}`
        : `Hello ${name}, following up on your promise to settle ${currencySymbol}${amount} on ${promiseDateFormatted}. Please complete the payment today via PayPal: ${payLink}`;

    default:
      return isHi
        ? `धन्यवाद ${name} जी, मैं दुकानदार को आपका संदेश बता दूंगा।`
        : `Thank you ${name}, I will pass your message to the stall owner.`;
  }
}
