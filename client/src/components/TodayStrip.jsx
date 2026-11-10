import React from 'react';
import { t } from '../lib/i18n.js';

/**
 * TodayStrip: Three big number cards (Collected, Pending, Khata)
 * Values come from GET /api/stats/today and update live via socket events.
 */
export default function TodayStrip({
  stats = {},
  currencySymbol = '₹',
  lang = 'hi',
  onSelectKhata,
}) {
  const collected = stats.collected ?? 0;
  const pending = stats.pending ?? 0;
  const khata = stats.khata ?? 0;

  return (
    <section className="today-strip" aria-label={lang === 'hi' ? 'आज का हिसाब' : "Today's summary"}>
      <div className="today-card today-card-paid">
        <div className="today-card-label">
          <span aria-hidden="true">✓</span> {t(lang, 'collected')}
        </div>
        <div className="today-card-value">
          {currencySymbol}
          {collected}
        </div>
      </div>

      <div className="today-card today-card-open">
        <div className="today-card-label">
          <span aria-hidden="true">⏳</span> {t(lang, 'pending')}
        </div>
        <div className="today-card-value">
          {currencySymbol}
          {pending}
        </div>
      </div>

      <button
        type="button"
        className="today-card today-card-khata today-card-clickable"
        onClick={onSelectKhata}
      >
        <div className="today-card-label">
          <span aria-hidden="true">📓</span> {t(lang, 'khata')}
        </div>
        <div className="today-card-value">
          {currencySymbol}
          {khata}
        </div>
      </button>
    </section>
  );
}

