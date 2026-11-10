import React, { useEffect } from 'react';

/**
 * PaymentSuccess Overlay:
 * Full-screen green check animation shown when `tab:paid` arrives.
 * Auto-dismisses after ~2 seconds.
 */
export default function PaymentSuccess({
  paidOverlay,
  currencySymbol = '₹',
  lang = 'hi',
  onDismiss,
}) {
  useEffect(() => {
    if (!paidOverlay) return undefined;
    const timer = setTimeout(() => {
      onDismiss?.();
    }, 2100);
    return () => clearTimeout(timer);
  }, [paidOverlay, onDismiss]);

  if (!paidOverlay) return null;

  const { tab } = paidOverlay;
  const itemsSummary = (tab?.items || [])
    .map((i) => `${i.qty}× ${i.name}`)
    .join(', ');

  return (
    <div
      className="payment-success-overlay"
      role="alertdialog"
      aria-live="assertive"
      onClick={onDismiss}
    >
      <div className="payment-success-card">
        <div className="payment-check-circle">
          <svg viewBox="0 0 64 64" width="84" height="84" aria-hidden="true">
            <circle cx="32" cy="32" r="30" fill="#FFFFFF" />
            <path
              d="M20 33l8 8 17-18"
              fill="none"
              stroke="#1B8A3A"
              strokeWidth="6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <div className="payment-success-order">
          {itemsSummary
            ? lang === 'hi'
              ? `${itemsSummary} (#${tab?.number}) — पेमेंट मिल गया!`
              : `${itemsSummary} (#${tab?.number}) — Received!`
            : lang === 'hi'
              ? `ऑर्डर #${tab?.number} भुगतान हो गया!`
              : `Order #${tab?.number} Paid!`}
        </div>

        <div className="payment-success-amount">
          {currencySymbol}
          {tab?.amount}
        </div>

        <div className="payment-success-sub">
          {tab?.paymentMethod === 'CASH'
            ? lang === 'hi'
              ? '💵 कैश प्राप्त हुआ'
              : '💵 Cash Received'
            : lang === 'hi'
              ? '✓ PayPal द्वारा सत्यापित'
              : '✓ Verified by PayPal'}
        </div>
      </div>
    </div>
  );
}

