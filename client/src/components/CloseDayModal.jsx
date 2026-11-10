import React, { useEffect, useState, useCallback } from 'react';
import { Volume2, X, CheckCircle2, ShieldCheck, AlertTriangle, BookOpen, Banknote } from 'lucide-react';
import { speakText } from '../lib/speech.js';

/**
 * CloseDayModal (Part B2):
 * Read-only end-of-day summary modal triggered from the header menu ("Close day").
 * Fetches `GET /api/day/summary?date=YYYY-MM-DD` and displays:
 * - Total collected (PayPal vs. Cash)
 * - Pending & Khata outstanding
 * - Total orders & Unpaid-at-close count
 * - Recovered by Bharosa today
 * - "Hear summary" button that speaks the deterministic summary in Hindi or English.
 */
export default function CloseDayModal({
  lang = 'hi',
  currencySymbol = '₹',
  onClose,
}) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/day/summary');
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not load day summary');
      }
      setSummary(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  const handleHearSummary = () => {
    if (!summary) return;
    const text = lang === 'hi' ? summary.spokenHi : summary.spokenEn;
    speakText(text, lang, [140, 70, 140]);
  };

  const sym = summary?.currencySymbol || currencySymbol;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={lang === 'hi' ? 'दिन का हिसाब (Close Day)' : 'Close Day Summary'}
    >
      <div className="close-day-modal">
        <div className="modal-top-bar">
          <div>
            <div className="close-day-badges">
              <span className="close-day-date-pill">{summary?.date || 'Today'}</span>
              {summary?.isDemoData && (
                <span className="demo-data-badge demo-badge-inline">
                  {lang === 'hi' ? 'डेमो डेटा' : 'Demo data'}
                </span>
              )}
            </div>
            <h2 className="modal-title">
              {lang === 'hi' ? 'दिन का पूरा हिसाब' : 'Close-Day Summary'}
            </h2>
          </div>

          <button
            type="button"
            className="btn-close-circle"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={24} />
          </button>
        </div>

        {loading ? (
          <div className="skeleton-stack" aria-busy="true">
            <div className="skeleton-box skeleton-tall" />
            <div className="skeleton-box" />
            <div className="skeleton-box" />
          </div>
        ) : error ? (
          <div className="state-box state-error">
            <p>{error}</p>
            <button
              type="button"
              className="primary-card-btn btn-surface-neutral"
              onClick={fetchSummary}
            >
              {lang === 'hi' ? 'फिर से कोशिश करें' : 'Retry'}
            </button>
          </div>
        ) : (
          summary && (
            <>
              {/* Hero Total Collected */}
              <div className="close-day-hero">
                <div className="close-day-hero-label">
                  {lang === 'hi' ? 'आज कुल जमा (Total Collected)' : 'Total Collected Today'}
                </div>
                <div className="close-day-hero-amount">
                  {sym}
                  {summary.totalCollected}
                </div>
                <div className="close-day-split-row">
                  <span className="split-pill split-paypal">
                    <CheckCircle2 size={16} /> PayPal: {sym}
                    {summary.paypalCollected} ({summary.paypalOrderCount})
                  </span>
                  <span className="split-pill split-cash">
                    <Banknote size={16} /> {lang === 'hi' ? 'कैश' : 'Cash'}: {sym}
                    {summary.cashCollected} ({summary.cashOrderCount})
                  </span>
                </div>
              </div>

              {/* Metrics Grid */}
              <div className="close-day-grid">
                <div className="close-day-stat-card">
                  <span className="stat-card-label">
                    {lang === 'hi' ? 'कुल ऑर्डर' : 'Total Orders'}
                  </span>
                  <strong className="stat-card-val">{summary.totalOrders}</strong>
                </div>

                <div className="close-day-stat-card">
                  <span className="stat-card-label">
                    <AlertTriangle size={15} />{' '}
                    {lang === 'hi' ? 'बंद होते समय बाकी' : 'Unpaid at Close'}
                  </span>
                  <strong className="stat-card-val stat-val-open">
                    {sym}
                    {summary.pendingAmount} ({summary.unpaidAtCloseCount})
                  </strong>
                </div>

                <div className="close-day-stat-card">
                  <span className="stat-card-label">
                    <BookOpen size={15} />{' '}
                    {lang === 'hi' ? 'खाता बकाया (कुल)' : 'Khata Outstanding'}
                  </span>
                  <strong className="stat-card-val stat-val-khata">
                    {sym}
                    {summary.khataOutstandingTotal}
                  </strong>
                </div>

                <div className="close-day-stat-card">
                  <span className="stat-card-label">
                    <ShieldCheck size={15} />{' '}
                    {lang === 'hi' ? 'भरोसा से वसूली' : 'Recovered Today'}
                  </span>
                  <strong className="stat-card-val stat-val-paid">
                    {sym}
                    {summary.recoveredAmount} ({summary.recoveredCount})
                  </strong>
                </div>
              </div>

              {/* Spoken Text Preview */}
              <div className="close-day-spoken-box">
                “{lang === 'hi' ? summary.spokenHi : summary.spokenEn}”
              </div>

              {/* Footer Actions */}
              <div className="close-day-actions">
                <button
                  type="button"
                  className="btn-confirm-huge"
                  onClick={handleHearSummary}
                >
                  <Volume2 size={24} />
                  <span>{lang === 'hi' ? 'हिसाब सुनें' : 'Hear Summary'}</span>
                </button>
              </div>
            </>
          )
        )}
      </div>
    </div>
  );
}

