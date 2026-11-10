# Architectural & Implementation Decisions (`DECISIONS.md`)

Whenever an implementation detail was open to interpretation, a sensible assumption was made and documented here so development could proceed rapidly without blocking.

## 1. Repository Root vs. `bharosa/` Subfolder
- **Decision:** Placed the project structure directly in the workspace root (`e:\Bharosa\`), which is already named `Bharosa`.
- **Reasoning:** Avoids redundant nesting (`e:\Bharosa\bharosa\`) and ensures deployment platforms (like Render) can immediately locate root configuration files or `server/` and `client/` directories cleanly.

## 2. Database & 7-Day Demo Seed Data
- **Decision:** Connected to `MONGODB_URI` (`mongodb://127.0.0.1:27017/bharosa` by default), with automatic seeding on startup (`ensureSeedData()`) if no `Vendor` document or `Tab` documents exist. Seeded 7 days of historical PayPal-confirmed (`paymentMethod: 'PAYPAL'`) and vendor-recorded cash (`paymentMethod: 'CASH'`) orders plus 1 active Khata tab for Raju.
- **Reasoning:** Guarantees the app boots out of the box with a populated `/income` 7-day bar chart, live Today Strip numbers, and an active Khata balance so the 60–90 second hackathon video can be recorded immediately with zero manual setup.

## 3. Currency Display vs. PayPal Sandbox Currency
- **Decision:** The vendor's menu prices are stored as numeric values (e.g., `20` for Masala Chai, `40` for Chaat). In the UI, amounts are displayed with a configurable currency symbol (`CURRENCY_SYMBOL`, default `₹`), while PayPal orders are created using `PAYPAL_CURRENCY` (default `USD`).
- **Reasoning:** PayPal Sandbox has limited INR support for non-Indian sandbox merchant accounts, whereas `USD` works universally across all sandbox accounts while keeping the street-vendor UI authentic in `₹`.

## 4. Sunlight-Readable High-Contrast Light Theme & Design Tokens
- **Decision:** Redesigned the vendor home screen, customer payment page (`/pay/:tabId`), and income statement (`/income`) around a high-contrast daylight palette (`--surface: #FFFFFF`, `--page-bg: #F4F5F7`, `--ink: #14181F`, `--paid: #1B8A3A`, `--open: #B7791F`, `--alert: #C62828`, `--khata: #1E5AA8`) with `Noto Sans Devanagari` + `Inter` at 18px base font and 56px+ primary touch targets.
- **Reasoning:** Street vendors work outdoors in bright sunlight where low-contrast dark-mode greys wash out. Every state is conveyed simultaneously by colour + icon + bilingual text (`StatusChip`) and respects `prefers-reduced-motion`.

## 5. QR Code Target (`/pay/:tabId`) & Customer Receipt Flow
- **Decision:** The vendor's `QrView` encodes `${window.location.origin}/pay/${tab._id}` (with a direct link to the PayPal approval URL as well). Scanning the QR opens the mobile-first Customer Payment Page (`/pay/:tabId`), which displays the itemised bill and a giant **Pay with PayPal** button. Once paid (via PayPal return capture or verified webhook), `/pay/:tabId` automatically transitions to the **Confirmed by PayPal** digital receipt.
- **Reasoning:** Gives customers a clean itemised bill before approval and a verifiable digital receipt immediately after payment without requiring any login.

## 6. Stall Assistant ("Ask Your Stall") Deterministic Numbers
- **Decision:** In `POST /api/assistant/ask`, the LLM (or keyword classifier fallback) is restricted strictly to classifying the question into one of 6 fixed intents (`TODAY_TOTAL`, `PENDING_TABS`, `KHATA_LIST`, `KHATA_CUSTOMER`, `BUSIEST_HOUR`, `UNKNOWN`) validated by Zod. All rupee amounts and counts are queried deterministically from MongoDB and phrased via templates in Hindi or English.
- **Reasoning:** Prevents the AI from ever hallucinating financial figures or customer balances.


## 7. Round 2: 7-Day Income Chart Local Date Bucketing (`toLocalDateKey`)
- **Decision:** Replaced `new Date().toISOString().slice(0, 10)` with local calendar date bucketing (`toLocalDateKey(dateObj)`) in `server/src/routes/income.js` and anchored seeded timestamps in `server/src/services/seed.js` to local calendar noon (`new Date(y, m, d - daysAgo, 12, 0, 0)`).
- **Reasoning:** In IST (`+05:30`), `toISOString()` converts local midnight (`00:00:00+05:30`) to the previous UTC day (`18:30:00Z`), shifting bucket keys by 1 day and causing the 7-day chart to miss a day or mismatch `weeklyTotal`. Using local calendar keys guarantees all 7 daily bars (oldest to newest, including zero-value days) always render and their values strictly sum to `weeklyTotal`.

## 8. Round 2: "Recovered by Bharosa" Metric (`GET /api/stats/recovered`)
- **Decision:** Defined a "Recovered by Bharosa" order as any `PAID` tab within the window (`days=7` default) where `alertedAt` is non-null and `paidAt > alertedAt`.
- **Reasoning:** Measures real money rescued after Bharosa's 30-second walk-off alert or khata reminder triggered, without inventing or extrapolating numbers. Any seeded or simulated orders carry a visible **Demo data** badge.

## 9. Round 2: "The Usual" (`usual: true`) Deterministic Resolution
- **Decision:** When the parser detects phrases like *"Raju ka roz wala"*, *"Raju's usual"*, or *"same as yesterday for Raju"*, `POST /api/tabs/parse` queries the customer's last 10 tabs in MongoDB, normalises each tab's item combination (`name:qty`), picks the most frequent combination (breaking ties by most recent `createdAt`), and computes prices strictly from the vendor's menu. If the customer has no prior tabs, it returns `needsConfirmation: true` with `"No usual order found for <Customer>"`.
- **Reasoning:** Lets the vendor serve daily regulars with a single phrase while keeping item selection and pricing 100% deterministic from MongoDB.

## 10. Round 2: Smart Credit Limit Rule (`GET /api/customers/:id/credit-suggestion`)
- **Decision:** Implemented `computeSmartCreditSuggestion()` in `server/src/routes/customers.js` using a transparent formula over the customer's historical khata tabs: base anchor `((avgSettled + largestSettled) / 2) * 3.2` (or ₹200 starter baseline), scaled by repayment rate (`0.5 + 0.5 * repaymentRate`), speed factor (`1.15x` if `avgDaysToRepay <= 3`, `0.8x` if `> 7`), and overdue cooldown, rounded to the nearest ₹50 and clamped to `[₹100, ₹2000]`. Exceeding an accepted limit shows a non-blocking soft warning on `ConfirmationCard`.
- **Reasoning:** Gives street vendors an explainable, one-tap credit guardrail without ever blocking a sale.


## 11. Round 3: Two-Way WhatsApp Collector & Deterministic Money Rule
- **Decision:** Inbound WhatsApp messages (`POST /api/whatsapp/inbound` and dev-only `POST /api/dev/whatsapp-inbound`) are verified with `X-Twilio-Signature` (HMAC-SHA1), deduplicated by `MessageSid`, and matched to a consenting `Customer` by E.164 phone number (unknown numbers are ignored with redacted logging). `parseCustomerReply()` classifies replies into `PROMISE_DATE`, `PARTIAL_NOW`, `PAYING_NOW`, `DISPUTE`, `OPT_OUT`, `QUESTION`, or `OTHER` with a deterministic regex/keyword fallback.
- **Reasoning:** Ensures that **a customer claim ("I paid") never modifies balances**; balances only change when a verified PayPal webhook (`applyVerifiedPayment`) or vendor cash confirmation arrives. Outbound replies are enforced against hard guardrails (`validateCollectorReplyGuardrails`), rate limits (`MAX_DAILY_OUTBOUND=2`, `MAX_WEEKLY_OUTBOUND=4`, `MAX_REMINDERS=4`), and quiet hours (`21:00–08:00 IST`).

## 12. Round 3: Adaptive Alert Timing (`computeAdaptiveAlertTiming` & `alertAfterSeconds`)
- **Decision:** Grouped historical `PAY_NOW` PayPal orders into 6 time-of-day buckets (`07–11`, `11–15`, `15–18`, `18–21`, `21–24`, `00–07`). Buckets with `>= MIN_SAMPLES` (default 15) compute `p50` and `p90` and set `alertSeconds = clamp(round(p90 * 1.2), 20, 120)` (`source: "learned"`), while sparser buckets use `ALERT_SECONDS` (`30s`, `source: "default"`). When a tab is created, `alertAfterSeconds` is snapshotted onto the `Tab` document so both the server alert job (`checkOverdueTabs`) and `CountdownRing.jsx` always agree across page refreshes.
- **Reasoning:** Gives evening rush hours more patience (e.g. ~46s) to eliminate false alerts while keeping quiet morning hours snappy (~22s).
