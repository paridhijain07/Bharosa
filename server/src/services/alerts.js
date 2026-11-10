import { Tab, Vendor } from '../models/index.js';
import { emitSocketEvent } from '../sockets.js';
import { broadcastStatsUpdated } from '../routes/stats.js';

let alertIntervalId = null;
let timingRecomputeIntervalId = null;
let cachedTimingReport = null;

/**
 * Default time-of-day buckets (24-hour clock in local stall time).
 */
export const TIME_OF_DAY_BUCKETS = [
  { id: 'morning', label: '07:00–11:00 (Morning)', labelHi: 'सुबह 7–11 बजे', startHour: 7, endHour: 11 },
  { id: 'midday', label: '11:00–15:00 (Lunch)', labelHi: 'दोपहर 11–3 बजे', startHour: 11, endHour: 15 },
  { id: 'afternoon', label: '15:00–18:00 (Tea Rush)', labelHi: 'शाम 3–6 बजे (चाय समय)', startHour: 15, endHour: 18 },
  { id: 'evening', label: '18:00–21:00 (Evening Rush)', labelHi: 'शाम 6–9 बजे (भीड़ समय)', startHour: 18, endHour: 21 },
  { id: 'night', label: '21:00–24:00 (Late Evening)', labelHi: 'रात 9–12 बजे', startHour: 21, endHour: 24 },
  { id: 'early', label: '00:00–07:00 (Early Hours)', labelHi: 'रात 12–सुबह 7 बजे', startHour: 0, endHour: 7 },
];

/**
 * Compute percentile (0..1) on a sorted ascending array of numbers.
 */
function computePercentile(sortedValues, p) {
  if (!sortedValues || sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0];
  const idx = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil(p * sortedValues.length) - 1)
  );
  return sortedValues[idx];
}

/**
 * Part 2.2: Deterministic, explainable Adaptive Alert Timing learning function.
 *
 * Rules:
 * - Filters `tabs` to `PAY_NOW` orders paid via `PAYPAL` with valid `createdAt` and `paidAt`
 *   where `0 < (paidAt - createdAt) <= 600s` (excludes multi-day khata settlements).
 * - Groups payment durations (in seconds) into `TIME_OF_DAY_BUCKETS` by `createdAt.getHours()`.
 * - For each bucket with at least `minSamples` (default 15):
 *     computes `p50` and `p90`, sets `alertSeconds = clamp(round(p90 * 1.2), minAlert, maxAlert)`,
 *     and marks `source: "learned"`.
 * - Buckets with fewer than `minSamples` fall back to `defaultSeconds` (default 30) and `source: "default"`.
 * - If `adaptiveEnabled === false`, every bucket uses `defaultSeconds` as its active `effectiveAlertSeconds`.
 */
export function computeAdaptiveAlertTiming(tabs = [], options = {}) {
  const defaultSeconds = Number(options.defaultSeconds ?? process.env.ALERT_SECONDS ?? 30);
  const minSamples = Number(options.minSamples ?? process.env.MIN_SAMPLES ?? 15);
  const minAlert = Number(options.minAlert ?? process.env.MIN_ALERT_SECONDS ?? 20);
  const maxAlert = Number(options.maxAlert ?? process.env.MAX_ALERT_SECONDS ?? 120);
  const adaptiveEnabled =
    options.adaptiveEnabled !== undefined ? Boolean(options.adaptiveEnabled) : true;
  const nowHour =
    options.nowHour !== undefined ? Number(options.nowHour) : new Date().getHours();

  const bucketSamples = new Map(TIME_OF_DAY_BUCKETS.map((b) => [b.id, []]));
  let hasSeedData = Boolean(options.isDemoSeeded);

  for (const tab of tabs) {
    if (!tab) continue;
    const isPayNow = (tab.mode || 'PAY_NOW') === 'PAY_NOW';
    const isPayPalPaid = tab.status === 'PAID' && tab.paymentMethod === 'PAYPAL';
    if (!isPayNow || !isPayPalPaid || !tab.createdAt || !tab.paidAt) continue;

    const durationSec =
      (new Date(tab.paidAt).getTime() - new Date(tab.createdAt).getTime()) / 1000;
    // Ignore negative or multi-hour outliers (> 10 minutes) for live stall QR payments
    if (!Number.isFinite(durationSec) || durationSec <= 0 || durationSec > 600) continue;

    if (String(tab.paypal?.orderId || '').startsWith('SEED-')) {
      hasSeedData = true;
    }

    const hour =
      tab.hourOverride !== undefined
        ? Number(tab.hourOverride)
        : new Date(tab.createdAt).getHours();

    const matchedBucket = TIME_OF_DAY_BUCKETS.find(
      (b) => hour >= b.startHour && hour < b.endHour
    );
    if (matchedBucket) {
      bucketSamples.get(matchedBucket.id).push(durationSec);
    }
  }

  const buckets = TIME_OF_DAY_BUCKETS.map((b) => {
    const raw = bucketSamples.get(b.id) || [];
    const sorted = [...raw].sort((x, y) => x - y);
    const samples = sorted.length;
    const isCurrent = nowHour >= b.startHour && nowHour < b.endHour;

    if (samples >= minSamples) {
      const p50 = Math.round(computePercentile(sorted, 0.5));
      const p90 = Math.round(computePercentile(sorted, 0.9));
      const learnedSeconds = Math.min(
        maxAlert,
        Math.max(minAlert, Math.round(p90 * 1.2))
      );
      const activeSeconds = adaptiveEnabled ? learnedSeconds : defaultSeconds;

      const sentenceEn = `Between ${b.startHour}:00 and ${b.endHour}:00 customers usually pay within ${p90} seconds (median ${p50}s), so alerts wait ${learnedSeconds} seconds.`;
      const sentenceHi = `${b.labelHi} में ग्राहक आमतौर पर ${p90} सेकंड में पेमेंट करते हैं, इसलिए अलर्ट ${learnedSeconds} सेकंड इंतज़ार करता है।`;

      return {
        id: b.id,
        label: b.label,
        labelHi: b.labelHi,
        startHour: b.startHour,
        endHour: b.endHour,
        samples,
        p50,
        p90,
        learnedSeconds,
        alertSeconds: activeSeconds,
        source: 'learned',
        isCurrent,
        sentenceEn,
        sentenceHi,
      };
    }

    const sentenceEn = `Between ${b.startHour}:00 and ${b.endHour}:00 (${samples}/${minSamples} samples), alerts use the default ${defaultSeconds} seconds.`;
    const sentenceHi = `${b.labelHi} (${samples}/${minSamples} ऑर्डर) के लिए डिफ़ॉल्ट ${defaultSeconds} सेकंड अलर्ट समय लागू है।`;

    return {
      id: b.id,
      label: b.label,
      labelHi: b.labelHi,
      startHour: b.startHour,
      endHour: b.endHour,
      samples,
      p50: samples > 0 ? Math.round(computePercentile(sorted, 0.5)) : null,
      p90: samples > 0 ? Math.round(computePercentile(sorted, 0.9)) : null,
      learnedSeconds: defaultSeconds,
      alertSeconds: defaultSeconds,
      source: 'default',
      isCurrent,
      sentenceEn,
      sentenceHi,
    };
  });

  const currentBucket =
    buckets.find((b) => b.isCurrent) ||
    buckets[0] || { alertSeconds: defaultSeconds, source: 'default' };

  return {
    adaptiveEnabled,
    defaultSeconds,
    minSamples,
    minAlert,
    maxAlert,
    currentHour: nowHour,
    currentAlertSeconds: adaptiveEnabled ? currentBucket.alertSeconds : defaultSeconds,
    currentBucket,
    buckets,
    isDemoData: hasSeedData || process.env.DEV_MODE === 'true',
    computedAt: new Date().toISOString(),
  };
}

/**
 * Recompute and cache adaptive alert timing from MongoDB.
 */
export async function recomputeStallAlertTiming() {
  const vendor = await Vendor.findOne();
  const adaptiveEnabled =
    vendor?.adaptiveAlertsEnabled !== undefined ? Boolean(vendor.adaptiveAlertsEnabled) : true;

  const paidPayNowTabs = await Tab.find({
    status: 'PAID',
    mode: 'PAY_NOW',
    paymentMethod: 'PAYPAL',
    paidAt: { $ne: null },
  })
    .sort({ createdAt: -1 })
    .limit(500);

  cachedTimingReport = computeAdaptiveAlertTiming(paidPayNowTabs, {
    adaptiveEnabled,
    isDemoSeeded: Boolean(vendor?.isDemoSeeded),
  });

  return cachedTimingReport;
}

/**
 * Returns the alert threshold (in seconds) for a newly created tab at `dateObj`.
 */
export async function resolveAlertSecondsForNewTab(dateObj = new Date()) {
  const defaultSeconds = Number(process.env.ALERT_SECONDS || 30);
  const vendor = await Vendor.findOne();
  const adaptiveEnabled =
    vendor?.adaptiveAlertsEnabled !== undefined ? Boolean(vendor.adaptiveAlertsEnabled) : true;

  if (!adaptiveEnabled) {
    return defaultSeconds;
  }

  if (!cachedTimingReport) {
    await recomputeStallAlertTiming();
  }

  const hour = new Date(dateObj).getHours();
  const bucket = cachedTimingReport?.buckets?.find(
    (b) => hour >= b.startHour && hour < b.endHour
  );

  return bucket ? Number(bucket.alertSeconds) : defaultSeconds;
}

/**
 * Check for unpaid tabs exceeding their stored `alertAfterSeconds` (or `ALERT_SECONDS` fallback)
 * and transition them from OPEN -> ALERTED.
 * Never alerts the same tab twice.
 */
export async function checkOverdueTabs() {
  const defaultAlertSeconds = Number(process.env.ALERT_SECONDS || 30);
  const nowMs = Date.now();

  const openTabs = await Tab.find({
    status: 'OPEN',
    mode: 'PAY_NOW',
    alertedAt: null,
  }).populate('customerId');

  const alertedResults = [];

  for (const tab of openTabs) {
    const thresholdSec =
      tab.alertAfterSeconds != null && Number(tab.alertAfterSeconds) > 0
        ? Number(tab.alertAfterSeconds)
        : defaultAlertSeconds;

    const elapsedSec = (nowMs - new Date(tab.createdAt).getTime()) / 1000;
    if (elapsedSec < thresholdSec) continue;

    // Atomic update so concurrent checks never alert the same tab twice
    const updated = await Tab.findOneAndUpdate(
      { _id: tab._id, status: 'OPEN', alertedAt: null },
      {
        $set: {
          status: 'ALERTED',
          alertedAt: new Date(),
        },
      },
      { new: true }
    ).populate('customerId');

    if (updated) {
      const itemsText =
        (updated.items || []).map((i) => `${i.qty} ${i.name}`).join(', ') ||
        `Order ${updated.number}`;
      const payload = {
        tab: updated,
        spokenAlertEn: `Alert! ${itemsText}, ${updated.amount} rupees not paid!`,
        spokenAlertHi: `ध्यान दें! ${itemsText} के ${updated.amount} रुपये नहीं मिले!`,
        alertLatencyMs: updated.alertedAt.getTime() - updated.createdAt.getTime(),
        alertAfterSeconds: thresholdSec,
      };
      emitSocketEvent('tab:alert', payload);
      alertedResults.push(updated);
    }
  }

  if (alertedResults.length > 0) {
    await broadcastStatsUpdated();
  }

  return alertedResults;
}

/**
 * Starts the 5-second overdue check job + 10-minute adaptive timing recompute job
 */
export function startAlertJob(intervalMs = 5000) {
  if (alertIntervalId) {
    clearInterval(alertIntervalId);
  }
  if (timingRecomputeIntervalId) {
    clearInterval(timingRecomputeIntervalId);
  }

  recomputeStallAlertTiming().catch((err) => {
    console.warn('[AlertTiming] Initial recompute warning:', err.message);
  });

  alertIntervalId = setInterval(() => {
    checkOverdueTabs().catch((err) => {
      console.error('[AlertJob] Error checking overdue tabs:', err.message);
    });
  }, intervalMs);

  // Recompute adaptive timing every 10 minutes (Part 2.2)
  timingRecomputeIntervalId = setInterval(() => {
    recomputeStallAlertTiming().catch((err) => {
      console.error('[AlertTiming] Scheduled recompute error:', err.message);
    });
  }, 10 * 60 * 1000);

  return alertIntervalId;
}

export function stopAlertJob() {
  if (alertIntervalId) {
    clearInterval(alertIntervalId);
    alertIntervalId = null;
  }
  if (timingRecomputeIntervalId) {
    clearInterval(timingRecomputeIntervalId);
    timingRecomputeIntervalId = null;
  }
}
