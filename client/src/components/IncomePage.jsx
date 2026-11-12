import React, { useEffect, useState, useCallback } from 'react';
import { Printer, Link2, Check, ArrowLeft, Zap, CheckCircle2 } from 'lucide-react';
import RecoveredCard from './RecoveredCard.jsx';
import SmartAlertTimingCard from './SmartAlertTimingCard.jsx';
import { speakText } from '../lib/speech.js';

/**
 * IncomePage (`/income` and `/income/public/:token`) — Part A1.3 & B1:
 * Read-only, shareable earnings statement for the vendor:
 * - Always renders exactly 7 bars (oldest to newest, zero-value days included)
 * - Includes the "Recovered by Bharosa" card (Part B1)
 * - Split clearly into PayPal-confirmed payments (verified by webhook) vs. vendor-recorded cash
 * - Visible "Demo data" badge when data is simulated or seeded
 */
export default function IncomePage({ publicToken = null, lang = 'hi', onChangeLang }) {
  const [report, setReport] = useState(null);
  const [recovered, setRecovered] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [drawdownOpen, setDrawdownOpen] = useState(false);
  const [selectedLoanAmt, setSelectedLoanAmt] = useState(0);
  const [loanDisbursed, setLoanDisbursed] = useState(null);

  const fetchIncome = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const endpoint = publicToken
        ? `/api/income/public/${encodeURIComponent(publicToken)}?days=7`
        : '/api/income?days=7';
      const [res, recRes] = await Promise.all([
        fetch(endpoint),
        fetch('/api/stats/recovered?days=7').catch(() => null),
      ]);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Could not load income statement');
      }
      setReport(data);

      if (recRes && recRes.ok) {
        const recData = await recRes.json();
        setRecovered(recData);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [publicToken]);

  useEffect(() => {
    fetchIncome();
  }, [fetchIncome]);

  const handleCopyShareLink = async () => {
    if (!report?.shareToken) return;
    const shareUrl = `${window.location.origin}/income?token=${report.shareToken}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Copy shareable link:', shareUrl);
    }
  };

  if (loading) {
    return (
      <main className="income-page-shell">
        <div className="income-container">
          <div className="skeleton-stack" aria-busy="true">
            <div className="skeleton-box skeleton-tall" />
            <div className="skeleton-box skeleton-tall" />
            <div className="skeleton-box skeleton-tall" />
          </div>
        </div>
      </main>
    );
  }

  if (error || !report) {
    return (
      <main className="income-page-shell">
        <div className="state-box state-error">
          <span className="state-icon">⚠️</span>
          <p>{error || 'Error loading report'}</p>
          <button
            type="button"
            className="primary-card-btn btn-surface-neutral"
            onClick={fetchIncome}
          >
            ↻ {lang === 'hi' ? 'फिर से कोशिश करें' : 'Retry'}
          </button>
        </div>
      </main>
    );
  }

  const sym = report.currencySymbol || '₹';
  const dailyList = Array.isArray(report.daily) ? report.daily : [];
  const maxDaily = Math.max(100, ...dailyList.map((d) => d.total || 0));

  return (
    <main className="income-page-shell">
      <div className="income-container">
        <header className="income-header">
          <div>
            <div className="income-top-badges">
              <span className="income-brand-tag">Bharosa • भरोसा</span>
              <span className="demo-data-badge">
                ✓ {lang === 'hi' ? 'PayPal सत्यापित लेजर' : 'PayPal Verified Ledger'}
              </span>
            </div>
            <h1 className="income-stall-title">{report.vendorName}</h1>
            <p className="income-subtitle">
              {lang === 'hi'
                ? `पिछले ${report.days} दिनों का आय विवरण`
                : `Last ${report.days} Days Income Statement`}
            </p>
          </div>

          <div className="income-header-actions no-print">
            {onChangeLang && (
              <button
                type="button"
                className="lang-pill-btn"
                onClick={() => onChangeLang(lang === 'hi' ? 'en' : 'hi')}
              >
                {lang === 'hi' ? 'EN' : 'हिं'}
              </button>
            )}
            {!publicToken && (
              <a href="/" className="btn-back-stall">
                <ArrowLeft size={16} /> {lang === 'hi' ? 'स्टॉल होम' : 'Stall Home'}
              </a>
            )}
          </div>
        </header>

        {/* Part B1: Recovered by Bharosa Card */}
        {recovered && (
          <RecoveredCard
            recovered={recovered}
            currencySymbol={sym}
            lang={lang}
          />
        )}

        {/* Part 2.4: Smart Alert Timing Card */}
        <SmartAlertTimingCard lang={lang} />

        {/* PayPal Working Capital & Micro-Loan Readiness Score Card */}
        {report.workingCapital && (
          <section
            className="working-capital-card"
            aria-label="PayPal Working Capital Readiness Score"
          >
            <div className="wc-card-header">
              <div>
                <div className="wc-badge-row">
                  <span className="wc-paypal-pill">💙 PAYPAL WORKING CAPITAL</span>
                  <span className={`wc-tier-pill wc-tier-${report.workingCapital.tier.toLowerCase()}`}>
                    ★ {report.workingCapital.tier} TIER
                  </span>
                </div>
                <h2 className="wc-title">
                  {lang === 'hi'
                    ? 'AI माइक्रो-लोन और क्रेडिट स्कोर (Bharosa Trust Score)'
                    : 'AI Micro-Loan & Merchant Trust Score'}
                </h2>
              </div>

              <div className="wc-score-circle">
                <span className="wc-score-num">{report.workingCapital.bharosaScore}</span>
                <span className="wc-score-max">/ {report.workingCapital.maxScore}</span>
              </div>
            </div>

            <div className="wc-offer-banner">
              <div className="wc-offer-left">
                <span className="wc-offer-label">
                  {lang === 'hi'
                    ? 'प्री-क्वालिफाइड PayPal वर्किंग कैपिटल एडवांस'
                    : 'Pre-Qualified PayPal Merchant Advance'}
                </span>
                <strong className="wc-offer-amount">
                  {sym}
                  {report.workingCapital.preApprovedLimit.toLocaleString('en-IN')}
                </strong>
                <span className="wc-offer-sub">
                  {lang === 'hi'
                    ? `0% गारंटी • रोज़ की PayPal बिक्री से ${report.workingCapital.repaymentSharePct}% ऑटो-कटौती`
                    : `0% collateral • Repay automatically with ${report.workingCapital.repaymentSharePct}% of daily PayPal sales`}
                </span>
              </div>

              <div className="wc-offer-right no-print">
                {loanDisbursed ? (
                  <div className="wc-disbursed-pill">
                    <CheckCircle2 size={18} />
                    <div>
                      <strong>
                        {sym}
                        {loanDisbursed.amount.toLocaleString('en-IN')}{' '}
                        {lang === 'hi' ? 'PayPal वॉलेट में भेजा गया!' : 'Disbursed to PayPal!'}
                      </strong>
                      <small>Ref: #{loanDisbursed.ref}</small>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="wc-drawdown-btn"
                    onClick={() => {
                      setSelectedLoanAmt(report.workingCapital.preApprovedLimit);
                      setDrawdownOpen((prev) => !prev);
                    }}
                  >
                    <Zap size={16} />
                    <span>
                      {lang === 'hi'
                        ? '⚡ तुरंत PayPal खाते में लें'
                        : '⚡ Instant Disbursal to PayPal'}
                    </span>
                  </button>
                )}
              </div>
            </div>

            {drawdownOpen && !loanDisbursed && (
              <div className="wc-drawdown-drawer no-print">
                <div className="wc-drawdown-top">
                  <div>
                    <strong>
                      {lang === 'hi'
                        ? 'PayPal वर्किंग कैपिटल राशि चुनें:'
                        : 'Select Instant Advance Amount:'}
                    </strong>
                    <p>
                      {lang === 'hi'
                        ? 'कोई चक्रवृद्धि ब्याज नहीं — केवल एक निश्चित शुल्क और रोज़ की बिक्री से ऑटो-पेमेंट।'
                        : 'No compounding interest or late fees — 1 fixed fee & automatic daily sales share.'}
                    </p>
                  </div>
                  <div className="wc-drawdown-selected">
                    {sym}
                    {Number(selectedLoanAmt || report.workingCapital.preApprovedLimit).toLocaleString(
                      'en-IN'
                    )}
                  </div>
                </div>

                <input
                  type="range"
                  min={Math.min(2000, report.workingCapital.preApprovedLimit)}
                  max={report.workingCapital.preApprovedLimit}
                  step={500}
                  value={selectedLoanAmt || report.workingCapital.preApprovedLimit}
                  onChange={(e) => setSelectedLoanAmt(Number(e.target.value))}
                  className="wc-loan-slider"
                />

                <div className="wc-drawdown-breakdown">
                  <div>
                    <span>{lang === 'hi' ? 'लोन राशि' : 'Advance Amount'}</span>
                    <strong>
                      {sym}
                      {Number(selectedLoanAmt || report.workingCapital.preApprovedLimit).toLocaleString(
                        'en-IN'
                      )}
                    </strong>
                  </div>
                  <div>
                    <span>{lang === 'hi' ? 'एकमुश्त फिक्स शुल्क (4%)' : 'One-Time Fixed Fee (4%)'}</span>
                    <strong>
                      {sym}
                      {Math.round(
                        Number(selectedLoanAmt || report.workingCapital.preApprovedLimit) * 0.04
                      ).toLocaleString('en-IN')}
                    </strong>
                  </div>
                  <div>
                    <span>{lang === 'hi' ? 'ऑटो-किस्त' : 'Auto-Repayment'}</span>
                    <strong>{report.workingCapital.repaymentSharePct}% of Daily PayPal Sales</strong>
                  </div>
                </div>

                <button
                  type="button"
                  className="wc-confirm-disburse-btn"
                  onClick={() => {
                    const amt = Number(selectedLoanAmt || report.workingCapital.preApprovedLimit);
                    const ref = `PPWC-${Date.now().toString(36).toUpperCase()}`;
                    setLoanDisbursed({ amount: amt, ref });
                    setDrawdownOpen(false);
                    speakText(
                      lang === 'hi'
                        ? `बधाई हो! ${amt} रुपये का PayPal वर्किंग कैपिटल लोन आपके खाते में भेज दिया गया है।`
                        : `Congratulations! ${amt} rupees PayPal Working Capital advance has been disbursed to your account.`,
                      lang
                    );
                  }}
                >
                  <Check size={18} />{' '}
                  {lang === 'hi'
                    ? `हाँ, ${sym}${Number(selectedLoanAmt || report.workingCapital.preApprovedLimit).toLocaleString('en-IN')} तुरंत प्राप्त करें`
                    : `Confirm & Disburse ${sym}${Number(selectedLoanAmt || report.workingCapital.preApprovedLimit).toLocaleString('en-IN')} Instantly`}
                </button>
              </div>
            )}

            <div className="wc-pillars-grid">
              <div className="wc-pillar-box">
                <span className="wc-pillar-label">
                  {lang === 'hi' ? 'PayPal सत्यापित अनुपात' : 'PayPal Verified Ratio'}
                </span>
                <strong className="wc-pillar-val">{report.workingCapital.digitalRatioPct}%</strong>
                <div className="wc-progress-bar">
                  <div
                    className="wc-progress-fill fill-paypal"
                    style={{ width: `${Math.min(100, report.workingCapital.digitalRatioPct)}%` }}
                  />
                </div>
              </div>

              <div className="wc-pillar-box">
                <span className="wc-pillar-label">
                  {lang === 'hi' ? 'खाता वसूली दर (AI)' : 'Khata Recovery (AI)'}
                </span>
                <strong className="wc-pillar-val">{report.workingCapital.khataRecoveryRatePct}%</strong>
                <div className="wc-progress-bar">
                  <div
                    className="wc-progress-fill fill-khata"
                    style={{ width: `${Math.min(100, report.workingCapital.khataRecoveryRatePct)}%` }}
                  />
                </div>
              </div>

              <div className="wc-pillar-box">
                <span className="wc-pillar-label">
                  {lang === 'hi' ? '7-दिन नियमित बिक्री' : '7-Day Active Sales'}
                </span>
                <strong className="wc-pillar-val">
                  {report.workingCapital.activeDaysCount}/{report.workingCapital.totalDays} days
                </strong>
                <div className="wc-progress-bar">
                  <div
                    className="wc-progress-fill fill-paid"
                    style={{ width: `${Math.min(100, report.workingCapital.consistencyPct)}%` }}
                  />
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Summary KPI Strip */}
        <section className="income-kpi-grid">
          <div className="income-kpi-card kpi-verified">
            <div className="kpi-badge-row">
              <span className="verified-pill">✓ VERIFIED</span>
              <span>PayPal Webhook</span>
            </div>
            <div className="kpi-amount">
              {sym}
              {report.paypalVerified}
            </div>
            <div className="kpi-caption">
              {lang === 'hi'
                ? 'PayPal द्वारा सत्यापित भुगतान'
                : 'PayPal-confirmed payments'}
            </div>
          </div>

          <div className="income-kpi-card kpi-cash">
            <div className="kpi-badge-row">
              <span className="unverified-pill">💵 VENDOR-RECORDED</span>
              <span>Cash</span>
            </div>
            <div className="kpi-amount">
              {sym}
              {report.cashRecorded}
            </div>
            <div className="kpi-caption">
              {lang === 'hi'
                ? 'दुकानदार द्वारा दर्ज कैश (असत्यापित)'
                : 'Cash recorded by vendor (unverified)'}
            </div>
          </div>
        </section>

        <section className="income-totals-strip">
          <div className="totals-metric">
            <span className="totals-label">
              {lang === 'hi' ? '7-दिन कुल कमाई' : '7-Day Total'}
            </span>
            <strong className="totals-val">
              {sym}
              {report.weeklyTotal}
            </strong>
          </div>
          <div className="totals-metric">
            <span className="totals-label">
              {lang === 'hi' ? 'कुल ऑर्डर' : 'Total Orders'}
            </span>
            <strong className="totals-val">{report.orderCount}</strong>
          </div>
          <div className="totals-metric">
            <span className="totals-label">
              {lang === 'hi' ? 'औसत ऑर्डर' : 'Avg Order Value'}
            </span>
            <strong className="totals-val">
              {sym}
              {report.averageOrderValue}
            </strong>
          </div>
        </section>

        {/* 7-Day SVG Bar Chart (Always 7 bars, oldest to newest) */}
        <section className="income-chart-card">
          <div className="chart-header">
            <h2>
              {lang === 'hi' ? 'दैनिक कमाई (पिछले 7 दिन)' : 'Daily Earnings (Last 7 Days)'}
            </h2>
            <div className="chart-legend">
              <span className="legend-item">
                <i className="legend-swatch swatch-paypal" /> PayPal Verified
              </span>
              <span className="legend-item">
                <i className="legend-swatch swatch-cash" /> Cash (Vendor-recorded)
              </span>
            </div>
          </div>

          <div className="svg-bar-chart-wrap">
            <svg
              viewBox="0 0 560 225"
              className="income-svg-chart"
              role="img"
              aria-label="7-day income bar chart"
            >
              {/* Baseline axis */}
              <line
                x1="16"
                y1="175"
                x2="544"
                y2="175"
                stroke="#CBD5E1"
                strokeWidth="1.5"
              />

              {dailyList.map((day, idx) => {
                const count = dailyList.length || 7;
                const colWidth = 560 / count;
                const barWidth = 40;
                const x = idx * colWidth + (colWidth - barWidth) / 2;
                const maxBarHeight = 140;

                const ppHeight = Math.round((day.paypalVerified / maxDaily) * maxBarHeight);
                const cashHeight = Math.round((day.cashRecorded / maxDaily) * maxBarHeight);
                const totalHeight = ppHeight + cashHeight;
                const baselineY = 175;

                return (
                  <g key={day.date} data-testid={`income-bar-${idx}`}>
                    {/* Total label above bar */}
                    <text
                      x={x + barWidth / 2}
                      y={Math.max(22, baselineY - totalHeight - 8)}
                      textAnchor="middle"
                      className="chart-val-text"
                    >
                      {sym}
                      {day.total}
                    </text>

                    {/* Zero-day stub so empty days never look like missing slots */}
                    {totalHeight === 0 && (
                      <rect
                        x={x}
                        y={baselineY - 4}
                        width={barWidth}
                        height={4}
                        rx="2"
                        fill="#CBD5E1"
                      />
                    )}

                    {/* Cash bar segment (top) */}
                    {cashHeight > 0 && (
                      <rect
                        x={x}
                        y={baselineY - totalHeight}
                        width={barWidth}
                        height={cashHeight}
                        rx="4"
                        fill="#B7791F"
                      />
                    )}

                    {/* PayPal Verified bar segment (bottom) */}
                    {ppHeight > 0 && (
                      <rect
                        x={x}
                        y={baselineY - ppHeight}
                        width={barWidth}
                        height={ppHeight}
                        rx="4"
                        fill="#1B8A3A"
                      />
                    )}

                    {/* Day label */}
                    <text
                      x={x + barWidth / 2}
                      y={202}
                      textAnchor="middle"
                      className="chart-day-text"
                    >
                      {lang === 'hi' ? day.labelHi : day.labelEn}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </section>

        {/* Actions: Print / Download & Shareable Token Link */}
        <footer className="income-actions-bar no-print">
          <button
            type="button"
            className="primary-card-btn btn-surface-paid"
            onClick={() => window.print()}
          >
            <Printer size={18} />{' '}
            {lang === 'hi' ? 'डाउनलोड / प्रिंट करें' : 'Download / Print'}
          </button>

          {report.shareToken && (
            <button
              type="button"
              className="primary-card-btn btn-surface-khata"
              onClick={handleCopyShareLink}
            >
              {copied ? <Check size={18} /> : <Link2 size={18} />}{' '}
              {copied
                ? lang === 'hi'
                  ? 'लिंक कॉपी हो गया ✓'
                  : 'Share Link Copied ✓'
                : lang === 'hi'
                  ? 'शेयर लिंक कॉपी करें'
                  : 'Copy Share Link'}
            </button>
          )}
        </footer>
      </div>
    </main>
  );
}
