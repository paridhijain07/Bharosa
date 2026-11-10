import React, { useEffect, useState, useCallback } from 'react';
import { Clock, Sparkles, X } from 'lucide-react';

/**
 * SmartAlertTimingCard (Part 2.4):
 * Displays learned time-of-day alert thresholds (`GET /api/alerts/timing`),
 * an interactive Adaptive Alerts ON/OFF toggle (`PATCH /api/alerts/timing`),
 * a bar/step chart with the current time bucket highlighted,
 * human-friendly explanations phrased from deterministic p50/p90 stats,
 * and a visible "Demo data" badge when seeded/simulated.
 */
export default function SmartAlertTimingCard({
  lang = 'hi',
  isModal = false,
  onClose,
  onTimingChanged,
}) {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  const fetchTiming = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/alerts/timing');
      if (res.ok) {
        const data = await res.json();
        setReport(data);
      }
    } catch {
      // ignore error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTiming();
  }, [fetchTiming]);

  const handleToggleAdaptive = async () => {
    if (!report || toggling) return;
    setToggling(true);
    try {
      const nextVal = !report.adaptiveEnabled;
      const res = await fetch('/api/alerts/timing', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adaptiveEnabled: nextVal }),
      });
      if (res.ok) {
        const updated = await res.json();
        setReport(updated);
        onTimingChanged?.(updated);
      }
    } finally {
      setToggling(false);
    }
  };

  if (loading && !report) {
    return (
      <section className="smart-timing-card">
        <div className="skeleton-box" />
      </section>
    );
  }

  if (!report) return null;

  const buckets = report.buckets || [];
  const maxAlert = Math.max(60, ...buckets.map((b) => b.alertSeconds || 30));
  const highlightedBucket =
    buckets.find((b) => b.isCurrent) ||
    buckets.find((b) => b.source === 'learned') ||
    buckets[0];

  const cardInner = (
    <section
      className={`smart-timing-card ${isModal ? 'smart-timing-modal-card' : ''}`}
      aria-label={lang === 'hi' ? 'स्मार्ट अलर्ट समय' : 'Smart alert timing'}
    >
      <div className="smart-timing-header">
        <div>
          <div className="smart-timing-badges">
            <span className="smart-timing-eyebrow">
              <Sparkles size={15} />{' '}
              {lang === 'hi' ? 'स्मार्ट अलर्ट टाइमिंग' : 'Smart Alert Timing'}
            </span>
            {report.isDemoData && (
              <span className="demo-data-badge demo-badge-inline">
                {lang === 'hi' ? 'डेमो डेटा' : 'Demo data'}
              </span>
            )}
          </div>
          <h3 className="smart-timing-title">
            {lang === 'hi'
              ? `अभी का अलर्ट समय: ${report.currentAlertSeconds}s`
              : `Active Alert Delay: ${report.currentAlertSeconds}s`}
          </h3>
        </div>

        <div className="smart-timing-controls">
          <button
            type="button"
            className={`btn-adaptive-toggle ${
              report.adaptiveEnabled ? 'adaptive-on' : 'adaptive-off'
            }`}
            disabled={toggling}
            onClick={handleToggleAdaptive}
            aria-pressed={report.adaptiveEnabled}
          >
            <Clock size={15} />{' '}
            {lang === 'hi'
              ? `अनुकूली (Adaptive): ${report.adaptiveEnabled ? 'चालू ✓' : 'बंद'}`
              : `Adaptive: ${report.adaptiveEnabled ? 'ON ✓' : 'OFF'}`}
          </button>

          {isModal && onClose && (
            <button
              type="button"
              className="btn-close-circle"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={20} />
            </button>
          )}
        </div>
      </div>

      {/* Highlighted friendly explanation sentence */}
      {highlightedBucket && (
        <p className="smart-timing-highlight-sentence">
          {lang === 'hi' ? highlightedBucket.sentenceHi : highlightedBucket.sentenceEn}
        </p>
      )}

      {/* Time-of-Day Step / Bar Chart */}
      <div className="timing-buckets-grid">
        {buckets.map((b) => {
          const heightPct = Math.max(
            24,
            Math.round(((b.alertSeconds || 30) / maxAlert) * 100)
          );
          return (
            <div
              key={b.id}
              className={`timing-bucket-col ${b.isCurrent ? 'bucket-current' : ''} ${
                b.source === 'learned' ? 'bucket-learned' : 'bucket-default'
              }`}
              title={lang === 'hi' ? b.sentenceHi : b.sentenceEn}
            >
              <span className="bucket-sec-val">{b.alertSeconds}s</span>
              <div className="bucket-bar-track">
                <div
                  className="bucket-bar-fill"
                  style={{ height: `${heightPct}%` }}
                />
              </div>
              <span className="bucket-time-label">
                {String(b.startHour).padStart(2, '0')}–{String(b.endHour).padStart(2, '0')}h
              </span>
              <span className="bucket-source-tag">
                {b.source === 'learned'
                  ? lang === 'hi'
                    ? `सीखा (${b.samples})`
                    : `p90=${b.p90}s (${b.samples})`
                  : lang === 'hi'
                    ? 'डिफ़ॉल्ट'
                    : 'default'}
              </span>
            </div>
          );
        })}
      </div>

      {/* Per-bucket friendly sentences list */}
      <ul className="timing-sentences-list">
        {buckets
          .filter((b) => b.source === 'learned' || b.isCurrent)
          .map((b) => (
            <li key={b.id} className="timing-sentence-item">
              <strong>
                {lang === 'hi' ? b.labelHi : b.label}
                {b.isCurrent ? (lang === 'hi' ? ' (अभी)' : ' (Now)') : ''}:
              </strong>{' '}
              {lang === 'hi' ? b.sentenceHi : b.sentenceEn}
            </li>
          ))}
      </ul>
    </section>
  );

  if (isModal) {
    return (
      <div
        className="modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label="Smart Alert Timing"
      >
        {cardInner}
      </div>
    );
  }

  return cardInner;
}

