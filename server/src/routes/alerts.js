import express from 'express';
import { z } from 'zod';
import { Vendor } from '../models/index.js';
import { recomputeStallAlertTiming } from '../services/alerts.js';

const router = express.Router();

const ToggleSchema = z.object({
  adaptiveEnabled: z.boolean(),
});

/**
 * GET /api/alerts/timing
 * Returns the learned time-of-day alert timing buckets, current active threshold,
 * human-friendly explanations, and Demo data badge flag.
 */
router.get('/timing', async (req, res) => {
  try {
    const report = await recomputeStallAlertTiming();
    return res.json(report);
  } catch (err) {
    console.error('[GET /api/alerts/timing] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/alerts/timing
 * Toggles Vendor's `adaptiveAlertsEnabled` on/off and recomputes timing.
 */
router.patch('/timing', async (req, res) => {
  try {
    const parsed = ToggleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'adaptiveEnabled boolean is required' });
    }

    let vendor = await Vendor.findOne();
    if (vendor) {
      vendor.adaptiveAlertsEnabled = parsed.data.adaptiveEnabled;
      await vendor.save();
    }

    const report = await recomputeStallAlertTiming();
    return res.json(report);
  } catch (err) {
    console.error('[PATCH /api/alerts/timing] Error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;

