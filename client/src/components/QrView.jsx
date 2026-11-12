import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { t } from '../lib/i18n.js';

/**
 * QrView:
 * Very large high-contrast QR modal with amount and order number above,
 * a clear "Waiting for payment…" state with subtle animation, and a close button.
 * The QR encodes `/pay/:tabId` (or the PayPal approvalUrl) so customers scanning it
 * see the mobile Customer Payment page or go straight to PayPal checkout.
 */
export default function QrView({
  tab,
  currencySymbol = '₹',
  lang = 'hi',
  onClose,
  onMarkCash,
  onSimulatePay,
  onEditTab,
  devMode = false,
}) {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const customerPayUrl =
    typeof window !== 'undefined' && tab?._id
      ? `${window.location.origin}/pay/${tab._id}`
      : tab?.paypal?.approvalUrl || '';

  useEffect(() => {
    if (customerPayUrl) {
      QRCode.toDataURL(customerPayUrl, {
        width: 320,
        margin: 2,
        color: {
          dark: '#14181F',
          light: '#FFFFFF',
        },
      })
        .then(setQrDataUrl)
        .catch((err) => console.error('QR generation failed:', err));
    }
  }, [customerPayUrl]);

  if (!tab) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="qr-modal-card"
        role="dialog"
        aria-modal="true"
        aria-label={`QR Order #${tab.number}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="qr-header">
          <span className="qr-order-badge">
            {t(lang, 'orderPrefix')} #{tab.number}
          </span>
          <button
            type="button"
            className="btn-circle-close"
            onClick={onClose}
            aria-label="Close QR"
          >
            ✕
          </button>
        </div>

        <div className="qr-amount-giant">
          {currencySymbol}
          {tab.amount}
        </div>

        <div className="qr-items-summary">
          {(tab.items || []).map((i, idx) => (
            <span key={idx} className="qr-item-pill">
              {i.qty} × {i.name}
            </span>
          ))}
        </div>

        <div className="qr-frame">
          {qrDataUrl ? (
            <img
              src={qrDataUrl}
              alt={`PayPal QR for Order #${tab.number}`}
              className="qr-image-large"
            />
          ) : (
            <div className="qr-loading">QR…</div>
          )}
          <div className="paypal-brand-tag">PayPal • Scan to Pay</div>
        </div>

        <div className="qr-waiting-row">
          <span className="waiting-pulse-dot" aria-hidden="true" />
          <span>{t(lang, 'waitingPayment')}</span>
        </div>

        <div className="qr-actions-row">
          <button
            type="button"
            className="primary-card-btn btn-surface-cash"
            onClick={() => onMarkCash(tab._id)}
          >
            💵 {t(lang, 'cashBtn')}
          </button>

          <button
            type="button"
            className="primary-card-btn btn-surface-neutral"
            onClick={() => onEditTab(tab)}
          >
            ✏️ {t(lang, 'editBtn')}
          </button>
        </div>

        <div className="qr-links-footer">
          <a
            href={`/pay/${tab._id}`}
            target="_blank"
            rel="noreferrer"
            className="open-paypal-link"
          >
            🔗 {lang === 'hi' ? 'ग्राहक पेमेंट पेज खोलें (/pay)' : 'Open Customer Payment Page (/pay)'}
          </a>

          {devMode && (
            <button
              type="button"
              className="btn-simulate-webhook"
              onClick={() => onSimulatePay(tab._id)}
            >
              💙 {lang === 'hi' ? 'PayPal एक्सप्रेस पेमेंट (1-Tap)' : 'Pay with PayPal Express (1-Tap)'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
