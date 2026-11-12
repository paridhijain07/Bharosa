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
  वन: 1,
  one: 1,
  won: 1,
  a: 1,
  an: 1,
  '1': 1,
  '१': 1,
  do: 2,
  दो: 2,
  टू: 2,
  two: 2,
  to: 2,
  too: 2,
  tu: 2,
  du: 2,
  '2': 2,
  '२': 2,
  teen: 3,
  तीन: 3,
  थ्री: 3,
  tin: 3,
  three: 3,
  tree: 3,
  '3': 3,
  '३': 3,
  chaar: 4,
  char: 4,
  चार: 4,
  फोर: 4,
  four: 4,
  for: 4,
  '4': 4,
  '४': 4,
  paanch: 5,
  panch: 5,
  पांच: 5,
  पाँच: 5,
  फाइव: 5,
  five: 5,
  '5': 5,
  '५': 5,
  chhe: 6,
  che: 6,
  छह: 6,
  सिक्स: 6,
  six: 6,
  '6': 6,
  '६': 6,
  saat: 7,
  सात: 7,
  सेवन: 7,
  seven: 7,
  '7': 7,
  '७': 7,
  aath: 8,
  आठ: 8,
  एट: 8,
  eight: 8,
  '8': 8,
  '८': 8,
  nau: 9,
  नौ: 9,
  नाइन: 9,
  nine: 9,
  '9': 9,
  '९': 9,
  das: 10,
  दस: 10,
  टेन: 10,
  ten: 10,
  '10': 10,
  '१०': 10,
  aadha: 1,
  आधा: 1,
  half: 1,
};

/**
 * Normalizes common Web Speech API phonetic mis-transcriptions & Devanagari variants
 * so spoken Hindi/Hinglish/English orders reliably match menu items and customer names.
 */
function normalizeSpokenTranscript(raw = '') {
  return String(raw || '')
    .toLowerCase()
    .replace(/१/g, '1')
    .replace(/२/g, '2')
    .replace(/३/g, '3')
    .replace(/४/g, '4')
    .replace(/५/g, '5')
    .replace(/६/g, '6')
    .replace(/७/g, '7')
    .replace(/८/g, '8')
    .replace(/९/g, '9')
    .replace(/०/g, '0')
    // Normalize Devanagari numerals & words first (Note: JS \b does not match non-ASCII Devanagari)
    .replace(/एक|वन/g, ' 1 ')
    .replace(/दो|टू/g, ' 2 ')
    .replace(/तीन|थ्री/g, ' 3 ')
    .replace(/चार|फोर/g, ' 4 ')
    .replace(/पांच|पाँच|फाइव/g, ' 5 ')
    .replace(/छह|सिक्स/g, ' 6 ')
    .replace(/सात|सेवन/g, ' 7 ')
    .replace(/आठ|एट/g, ' 8 ')
    .replace(/नौ|नाइन/g, ' 9 ')
    .replace(/दस|टेन/g, ' 10 ')
    .replace(/आधा/g, ' 1 ')
    // Normalize Devanagari food & stall words
    .replace(/चाटें|चाट|चैट/g, ' chaat ')
    .replace(/मसाला\s*चाय|चाय/g, ' chai ')
    .replace(/समोसे|समोसा/g, ' samosa ')
    .replace(/लस्सी/g, ' lassi ')
    .replace(/वड़ा\s*पाव|बड़ा\s*पाव|वड़ापाव/g, ' vada pav ')
    .replace(/कचौरी|कचौड़ी|कचोरी/g, ' kachori ')
    .replace(/मसाला\s*डोसा|डोसा/g, ' masala dosa ')
    .replace(/कोल्ड\s*कॉफी/g, ' cold coffee ')
    .replace(/कॉफी/g, ' coffee ')
    .replace(/मैगी|नूडल्स/g, ' maggi ')
    .replace(/पनीर\s*रोल/g, ' paneer roll ')
    .replace(/वेज\s*सैंडविच|सैंडविच/g, ' veg sandwich ')
    .replace(/आइस्ड\s*टी/g, ' iced tea ')
    .replace(/लेमन\s*टी/g, ' lemon tea ')
    .replace(/जिंजर\s*टी|अदरक\s*चाय/g, ' ginger tea ')
    .replace(/मैंगो\s*शेक/g, ' mango shake ')
    .replace(/बनाना\s*शेक/g, ' banana shake ')
    .replace(/ओरियो\s*शेक|ओरियो/g, ' oreo ')
    .replace(/किटकैट\s*शेक|किटकैट/g, ' kit kat ')
    .replace(/स्ट्रॉबेरी\s*शेक|स्ट्रॉबेरी/g, ' strawberry ')
    .replace(/गन्ने\s*का\s*रस|गन्ना\s*जूस/g, ' sugarcane juice ')
    .replace(/नींबू\s*पानी|शिकंजी/g, ' shikanji ')
    .replace(/जलजीरा/g, ' jaljeera ')
    .replace(/नारियल\s*पानी/g, ' coconut water ')
    .replace(/राजू/g, ' raju ')
    .replace(/सुनीता/g, ' sunita ')
    .replace(/अमित/g, ' amit ')
    .replace(/मोहन/g, ' mohan ')
    .replace(/खाते|खाता|उधारी|उधार/g, ' khata ')
    .replace(/रोज़\s*वाला|रोज\s*वाला|हमेशा\s*वाला/g, ' roz wala ')
    // Normalize ASCII English homophones & Web Speech API mis-transcriptions
    .replace(/\b(chart|charts|chat|chhat|chath|chats)\b/gi, 'chaat')
    .replace(/\b(chay|chaai|chaye|try|tie)\b/gi, 'chai')
    .replace(/\b(samosas|samoosa|samose|some\s*osa)\b/gi, 'samosa')
    .replace(/\b(lassie|lasi|lacy)\b/gi, 'lassi')
    .replace(/\b(vada\s*pao|wada\s*pav|wada\s*pao|bada\s*pav)\b/gi, 'vada pav')
    .replace(/\b(kachodi|kachauri|kachoris)\b/gi, 'kachori')
    .replace(/\b(masala\s*dose|masala\s*dossa|dossa)\b/gi, 'masala dosa')
    .replace(/\b(cold\s*copy)\b/gi, 'cold coffee')
    .replace(/\b(maggie|magi)\b/gi, 'maggi')
    .replace(/\b(paneer\s*role)\b/gi, 'paneer roll')
    .replace(/\b(raju's|rajus)\b/gi, 'raju')
    .replace(/\b(sunita's)\b/gi, 'sunita')
    .replace(/\b(amit's)\b/gi, 'amit')
    .replace(/\b(mohan's)\b/gi, 'mohan')
    .replace(/\b(khate|khatay|udhari)\b/gi, 'khata')
    .replace(/\s+/g, ' ')
    .trim();
}

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

  const lower = normalizeSpokenTranscript(raw);

  // Detect KHATA mode keywords
  const khataRegex = /\b(khata|khate|udhaar|udhar|credit|account|खाता|उधार)\b/i;
  const isKhata = khataRegex.test(lower) || khataRegex.test(raw);

  // Detect "usual" keywords ("roz wala", "usual", "same as yesterday", "hamesha wala", "daily wala")
  const usualRegex =
    /\b(roz\s*wala|roj\s*wala|usual|same\s+as\s+yesterday|hamesha\s*wala|daily\s*wala|रोज़\s*वाला|रोज\s*वाला|हमेशा\s*वाला)\b/i;
  const isUsual = usualRegex.test(lower) || usualRegex.test(raw);

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
      lower.match(/([a-zA-Z]+)\s+(?:ka|ke|ki)\s+(?:khata|udhaar|udhar|roz|roj|usual|hamesha)/i) ||
      lower.match(/([a-zA-Z]+)'s\s+usual/i) ||
      lower.match(/for\s+([a-zA-Z]+)\b/i) ||
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

  // Match menu items and quantities (longest phrase first, filtering out ambiguous single-word aliases)
  const matchedItems = [];
  const tokens = lower
    .replace(/[.,!?]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  // Count how many menu items share each single-word token
  const wordItemCount = new Map();
  for (const menuItem of menu) {
    const rawWords = new Set(
      [menuItem.name, ...(menuItem.aliases || [])]
        .join(' ')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean)
    );
    for (const w of rawWords) {
      wordItemCount.set(w, (wordItemCount.get(w) || 0) + 1);
    }
  }

  // Build candidate (menuItem, alias) pairs
  const candidates = [];
  for (const menuItem of menu) {
    const canonLower = menuItem.name.toLowerCase().trim();
    const rawAliases = [
      canonLower,
      ...(menuItem.aliases || []).map((a) => String(a).toLowerCase().trim()),
    ];
    // Add tea/chai synonym when menu item is exact 'tea' or 'chai'
    if (canonLower === 'tea') rawAliases.push('chai');
    if (canonLower === 'chai') rawAliases.push('tea');

    const uniqueAliases = Array.from(new Set(rawAliases.filter(Boolean)));
    for (const alias of uniqueAliases) {
      const isSingleWord = !alias.includes(' ');
      if (
        isSingleWord &&
        alias !== canonLower &&
        (wordItemCount.get(alias) || 0) > 1
      ) {
        // Skip ambiguous single-word alias (e.g. "shake" shared across 10 shakes, or "tea" inside "lemon tea")
        continue;
      }
      candidates.push({ menuItem, alias });
    }
  }

  // Sort longest/most specific phrase first so "lemon tea" matches before "tea"
  candidates.sort((a, b) => b.alias.length - a.alias.length);

  let searchableText = ` ${lower} `;

  for (const { menuItem, alias } of candidates) {
    if (matchedItems.some((m) => m.name === menuItem.name)) continue;

    // Require word boundaries around ASCII aliases so "tea" doesn't match inside "steam"
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = /^[a-z0-9\s/&-]+$/i.test(alias)
      ? new RegExp(`(?:^|\\s)(${escaped})(?=\\s|$)`, 'i')
      : new RegExp(`(${escaped})`, 'i');

    const match = searchableText.match(regex);
    if (match && match.index !== undefined) {
      const matchStart = match.index + (match[0].length - match[1].length);
      const beforeText = searchableText.slice(0, matchStart).trim();
      const beforeTokens = beforeText.split(/\s+/).filter(Boolean);
      const prevWord = beforeTokens[beforeTokens.length - 1];
      const prevPrevWord = beforeTokens[beforeTokens.length - 2];

      const afterText = searchableText.slice(matchStart + match[1].length).trim();
      const afterTokens = afterText.split(/\s+/).filter(Boolean);
      const nextWord = afterTokens[0];

      let qty = 1;
      if (prevWord && HINDI_NUMERALS[prevWord] !== undefined) {
        qty = HINDI_NUMERALS[prevWord];
      } else if (prevWord && /^\d+$/.test(prevWord)) {
        qty = parseInt(prevWord, 10);
      } else if (
        prevWord &&
        ['plate', 'cup', 'glass', 'piece', 'प्लेट', 'कप', 'गिलास'].includes(prevWord) &&
        prevPrevWord &&
        (HINDI_NUMERALS[prevPrevWord] !== undefined || /^\d+$/.test(prevPrevWord))
      ) {
        qty =
          HINDI_NUMERALS[prevPrevWord] !== undefined
            ? HINDI_NUMERALS[prevPrevWord]
            : parseInt(prevPrevWord, 10);
      } else if (nextWord && HINDI_NUMERALS[nextWord] !== undefined) {
        qty = HINDI_NUMERALS[nextWord];
      } else if (nextWord && /^\d+$/.test(nextWord)) {
        qty = parseInt(nextWord, 10);
      }

      matchedItems.push({
        name: menuItem.name,
        qty,
        unitPrice: menuItem.price,
        unmatched: false,
      });

      // Mask matched span so shorter aliases cannot double-match inside it
      searchableText =
        searchableText.slice(0, matchStart) +
        ' '.repeat(match[1].length) +
        searchableText.slice(matchStart + match[1].length);
    }
  }

  // Only flag unknown words when ZERO menu items matched (e.g. "do pizza")
  let confidence = matchedItems.length > 0 ? 0.94 : 0.2;
  if (matchedItems.length === 0) {
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
      'bhaiya',
      'ji',
      'plate',
      'cup',
      'glass',
      'order',
      'de',
      'do',
      'dena',
      'lagao',
      'please',
      'ek',
      ...(customerName ? [customerName.toLowerCase()] : []),
    ]);

    const unknownWords = tokens.filter(
      (w) => !stopWords.has(w) && !/^\d+$/.test(w) && w.length > 2
    );

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
    reason: matchedItems.some((i) => i.unmatched)
      ? 'Not on menu'
      : needsConfirmation
        ? 'Not sure'
        : undefined,
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

  // Fast path: if deterministic parser already matched menu items cleanly or detected "usual", return immediately
  const detCheck = deterministicParseOrder(raw, menu, knownCustomers);
  if (detCheck.usual || (detCheck.items.length > 0 && !detCheck.needsConfirmation)) {
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
