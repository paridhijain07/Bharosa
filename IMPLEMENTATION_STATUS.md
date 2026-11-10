# Bharosa (भरोसा) — Complete Implementation Summary

This document summarizes everything implemented across the **Bharosa** codebase (`e:\Bharosa`) according to the PayPal AI Hackathon build specification.

---

## 1. Phase-by-Phase Implementation Status

| Phase | Requirement | Status | Key Files |
| :--- | :--- | :--- | :--- |
| **Phase 1** | Repo scaffold, MongoDB models, automatic seed data, `/healthz`, create tab + PayPal sandbox order returning `approvalUrl` | ✅ Completed | [`server/src/index.js`](file:///e:/Bharosa/server/src/index.js), [`server/src/models/`](file:///e:/Bharosa/server/src/models/index.js), [`server/src/services/seed.js`](file:///e:/Bharosa/server/src/services/seed.js), [`server/src/services/paypal.js`](file:///e:/Bharosa/server/src/services/paypal.js) |
| **Phase 2** | Verified PayPal webhook (`POST /api/paypal/webhook`), server-side capture, idempotency via `WebhookEvent`, mark `PAID`, Socket.IO live emission, Render deployment blueprint | ✅ Completed | [`server/src/routes/paypal.js`](file:///e:/Bharosa/server/src/routes/paypal.js), [`server/src/services/paymentProcessor.js`](file:///e:/Bharosa/server/src/services/paymentProcessor.js), [`server/src/sockets.js`](file:///e:/Bharosa/server/src/sockets.js), [`render.yaml`](file:///e:/Bharosa/render.yaml) |
| **Phase 3** | Mobile-first React PWA vendor screen, live tab cards, dynamic QR modal (`qrcode`), and top "Stall Light" status banner (green/red) | ✅ Completed | [`client/src/App.jsx`](file:///e:/Bharosa/client/src/App.jsx), [`client/src/components/TabCard.jsx`](file:///e:/Bharosa/client/src/components/TabCard.jsx), [`client/src/components/QrView.jsx`](file:///e:/Bharosa/client/src/components/QrView.jsx), [`client/src/components/StatusBanner.jsx`](file:///e:/Bharosa/client/src/components/StatusBanner.jsx) |
| **Phase 4** | Browser Web Speech API (`hi-IN` / `en-IN` fallback) + Listener AI (`llm.js` + Zod schema validation) + 1-tap order confirmation/correction + `SpeechSynthesis` & haptic vibration | ✅ Completed | [`client/src/lib/speech.js`](file:///e:/Bharosa/client/src/lib/speech.js), [`client/src/components/MicButton.jsx`](file:///e:/Bharosa/client/src/components/MicButton.jsx), [`server/src/services/llm.js`](file:///e:/Bharosa/server/src/services/llm.js) |
| **Phase 5** | 5-second background alert job (`ALERT_SECONDS`, default 30s), spoken overdue alert, blinking red Stall Light banner, and Cash Received button fallback | ✅ Completed | [`server/src/services/alerts.js`](file:///e:/Bharosa/server/src/services/alerts.js), [`server/src/routes/tabs.js`](file:///e:/Bharosa/server/src/routes/tabs.js) |
| **Phase 6** | Khata mode (`mode: 'KHATA'`), `whatsappConsent` toggle, Collector AI (`gentle` vs. `firm` tone), Twilio WhatsApp reminder with PayPal pay link, and spoken summary | ✅ Completed | [`server/src/routes/khata.js`](file:///e:/Bharosa/server/src/routes/khata.js), [`server/src/services/whatsapp.js`](file:///e:/Bharosa/server/src/services/whatsapp.js), [`client/src/components/KhataView.jsx`](file:///e:/Bharosa/client/src/components/KhataView.jsx) |
| **Phase 7** | 50-order walk-off & payment simulation script (`scripts/simulate.js`) generating `simulation-results.json` | ✅ Completed | [`server/scripts/simulate.js`](file:///e:/Bharosa/server/scripts/simulate.js), [`simulation-results.json`](file:///e:/Bharosa/simulation-results.json) |
| **Phase 8** | Comprehensive `README.md` (with Mermaid architecture diagram, setup, demo script, honest limitations, roadmap), `DECISIONS.md`, and automated test suite | ✅ Completed | [`README.md`](file:///e:/Bharosa/README.md), [`DECISIONS.md`](file:///e:/Bharosa/DECISIONS.md), [`server/tests/bharosa.test.js`](file:///e:/Bharosa/server/tests/bharosa.test.js) |

---

## 2. Database Models Implemented (`server/src/models/`)

1. **[`Vendor.js`](file:///e:/Bharosa/server/src/models/Vendor.js):**
   - Fields: `name`, `language` (`'hi' | 'en'`), `menu: [{ name, aliases[], price }]`.
   - Seeded automatically on startup with *Sharma Ji Chaat & Chai Stall* and 6 street-food items (*Chaat ₹40, Chai ₹20, Samosa ₹15, Lassi ₹50, Vada Pav ₹25, Kachori ₹30*) including Hindi/Hinglish aliases.
2. **[`Customer.js`](file:///e:/Bharosa/server/src/models/Customer.js):**
   - Fields: `name`, `phone` (validated E.164 format), `whatsappConsent` (boolean), `createdAt`.
   - Seeded with regulars: *Raju* (`whatsappConsent: true`), *Sunita* (`whatsappConsent: true`), and *Amit* (`whatsappConsent: false`).
3. **[`Tab.js`](file:///e:/Bharosa/server/src/models/Tab.js):**
   - Fields: `number` (auto-incrementing order number), `items: [{ name, qty, unitPrice }]`, `amount`, `currency`, `status` (`OPEN | PAID | ALERTED | KHATA | PARTIAL | REFUNDED | CANCELLED`), `mode` (`PAY_NOW | KHATA`), `customerId`, `paypal: { orderId, approvalUrl, captureId, paidAmount }`, `paymentMethod` (`PAYPAL | CASH`), `createdAt`, `paidAt`, `alertedAt`.
4. **[`Reminder.js`](file:///e:/Bharosa/server/src/models/Reminder.js):**
   - Fields: `tabId`, `customerId`, `attempt`, `tone` (`gentle | firm`), `channel` (`whatsapp`), `payLink`, `message`, `sentAt`, `status` (`SENT | FAILED | SKIPPED`), `error`.
5. **[`WebhookEvent.js`](file:///e:/Bharosa/server/src/models/WebhookEvent.js):**
   - Fields: `eventId` (unique index), `type`, `processedAt` — guarantees webhook idempotency.

---

## 3. Backend API Endpoints & Socket Events

### REST Endpoints
- **`GET /healthz`** — Returns server health, MongoDB connection state, and `devMode` status.
- **`POST /api/tabs/parse`** — Runs the **Listener AI** (`parseVoiceOrder`) on a raw voice transcript and returns `{ items[], amount, customerName?, customerId?, mode, confidence, needsConfirmation }`.
- **`POST /api/tabs`** — Creates a new `Tab` (and a PayPal Sandbox order via `POST /v2/checkout/orders` when `mode === 'PAY_NOW'`), returning `{ tab, approvalUrl }` and emitting `tab:created`.
- **`GET /api/tabs`** — Lists current and recent tabs along with vendor menu and currency settings.
- **`PATCH /api/tabs/:id`** — Allows vendor corrections (updating items/amount, cancelling, or marking cash received). If an open `PAY_NOW` order's items/amount are modified, automatically generates a new PayPal order and updates `approvalUrl`.
- **`POST /api/tabs/:id/cash`** — One-tap fallback to mark a tab settled in cash (`paymentMethod: 'CASH'`, `status: 'PAID'`).
- **`POST /api/tabs/:id/refund`** — Calls PayPal Payments v2 (`POST /v2/payments/captures/{capture_id}/refund`) to refund a captured order and marks the tab `REFUNDED`.
- **`POST /api/paypal/webhook`** — Verifies PayPal webhook headers via `POST /v1/notifications/verify-webhook-signature`, captures `CHECKOUT.ORDER.APPROVED` orders (`POST /v2/checkout/orders/{id}/capture`), processes `PAYMENT.CAPTURE.COMPLETED` events idempotently, checks currency/amount, marks the tab `PAID` (or `PARTIAL`), and emits `tab:paid`.
- **`GET /api/paypal/return`** & **`GET /api/paypal/sandbox-checkout/:tabId`** — Handles buyer approval redirects and provides a built-in interactive Sandbox Buyer Checkout page for local/QR demos.
- **`POST /api/khata/:tabId/remind`** — Runs the **Collector AI**, verifies `whatsappConsent`, creates a PayPal order for the outstanding khata balance, sends the WhatsApp reminder with 1x automatic retry on failure, records a `Reminder`, and emits `reminder:sent` + `summary:speak`.
- **`GET /api/customers`**, **`POST /api/customers`**, **`PATCH /api/customers/:id`** — Manages regulars, their live khata balances, reminder counts, and WhatsApp consent flags.
- **`POST /api/dev/simulate-payment/:tabId`** — Enabled only when `DEV_MODE=true`; invokes the exact same internal `applyVerifiedPayment` processor as a verified PayPal webhook.

### Socket.IO Events (`server -> client`)
- `tab:created` — New tab opened.
- `tab:paid` — Tab settled (triggers green card + spoken `"Order N paid"`).
- `tab:alert` — Tab open past `ALERT_SECONDS` (triggers blinking red Stall Light banner + spoken overdue alert + vibration).
- `tab:updated` — Tab corrected, partially paid, refunded, or cancelled.
- `reminder:sent` — WhatsApp credit reminder dispatched.
- `summary:speak` — Speaks the customer's khata reminder summary aloud.
- `reconcile:prompt` — Stretch feature: asks the vendor a 1-tap question when an unreferenced payment matches multiple open tabs of the same amount.

---

## 4. AI Components (`server/src/services/llm.js`)

1. **Listener AI (`parseVoiceOrder`):**
   - Understands Hindi numerals (`ek`, `do`, `teen`, `chaar`, `paanch`, etc.), Devanagari words, and Hinglish phrases (e.g., *"do chaat aur ek lassi, Raju ka khata"*).
   - Strictly maps matched items to the vendor's menu prices (never invents prices).
   - Validates output with **Zod** (`ParsedOrderSchema`) and retries once on malformed LLM JSON.
   - Flags `needsConfirmation: true` whenever `confidence < 0.6`, the transcript is empty, or an item is not on the menu.
2. **Collector AI (`generateCollectorReminder`):**
   - Checks `customer.whatsappConsent` before sending.
   - Uses a warm, `gentle` tone on Attempt 1 and a polite, `firm` tone on Attempt 2+ (never shaming or threatening).
   - Includes the customer's name, item summary, outstanding amount, and PayPal `approvalUrl` pay link in Hindi or English.
   - Validates output with **Zod** (`CollectorDecisionSchema`) and includes a deterministic template fallback.
3. **Spoken Summaries (`buildSpokenKhataSummary` & End-of-Day Summary):**
   - Generates concise Hindi and English spoken sentences for `SpeechSynthesis` (e.g., *"Raju owes 240 rupees, reminded twice, no reply."*).
4. **Reconciler (`applyVerifiedPayment` in `paymentProcessor.js`):**
   - If a payment arrives without a matching `custom_id` or `orderId`, searches open tabs by `amount`. If one matches, settles it automatically; if multiple match, emits `reconcile:prompt` to ask the vendor.

---

## 5. Frontend PWA (`client/src/`)

- **[`StatusBanner.jsx`](file:///e:/Bharosa/client/src/components/StatusBanner.jsx) ("The Stall Light"):** Sticky full-width top bar — solid green when all tabs are clear, blinking bright red (`🚨 N UNPAID`) when any tab is in `ALERTED` status. Displays only counts, never customer identity.
- **[`MicButton.jsx`](file:///e:/Bharosa/client/src/components/MicButton.jsx):** Giant 92px-tall **Speak Order** button + **Add by Tap** fallback button + 1-tap demo voice chips (`"do chaat"`, `"ek chai aur do samosa"`, `"Raju, 2 chai, khata"`).
- **[`QrView.jsx`](file:///e:/Bharosa/client/src/components/QrView.jsx):** High-contrast modal displaying the dynamic PayPal QR code (`qrcode`), order number, items, and amount. Flashes green and auto-closes upon payment.
- **[`TabCard.jsx`](file:///e:/Bharosa/client/src/components/TabCard.jsx):** Color-coded cards for `OPEN`, `PAID`, `ALERTED`, `KHATA`, `PARTIAL`, `REFUNDED`, and `CANCELLED` tabs with large action buttons (`QR`, `Cash`, `Edit`, `Remind on WhatsApp`, `Refund`).
- **[`KhataView.jsx`](file:///e:/Bharosa/client/src/components/KhataView.jsx):** Displays regular customers, their outstanding khata balance, WhatsApp consent checkbox, reminder count, **Remind Now** button, and **Hear Spoken Summary** button.

---

## 6. Verification & Simulation Results

- **Unit & Integration Tests ([`server/tests/bharosa.test.js`](file:///e:/Bharosa/server/tests/bharosa.test.js)):**
  - `3 / 3` passing (`node --test server/tests/bharosa.test.js`).
- **50-Order Walk-Off Simulation ([`server/scripts/simulate.js`](file:///e:/Bharosa/server/scripts/simulate.js) & [`simulation-results.json`](file:///e:/Bharosa/simulation-results.json)):**
  - Simulated `50` tabs (`42` paid after random delays, `8` walk-offs).
  - **Result:** `"Detected 8/8 walk-offs, median alert latency 33s, 0 false alerts."`

