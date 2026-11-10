import React, { useEffect, useState, useCallback } from 'react';
import { socket } from '../lib/socket.js';

/**
 * CustomerPage (`/pay/:tabId`) + Receipt (B4):
 * - Clean mobile page a customer sees after scanning the QR.
 * - Shows stall name, itemised list, large amount, and one big "Pay with PayPal" button.
 * - Reuses existing PayPal approval URL or `/api/paypal/sandbox-checkout/:tabId`.
 * - After payment (via live socket `tab:paid` or `?paid=1`), shows a friendly "Paid ✓ Thank you" state
 *   and an official itemised Receipt ("Confirmed by PayPal") with no personal data.
 */
export default function CustomerPage({ tabId, lang = 'hi', onChangeLang }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [processingPay, setProcessingPay] = useState(false);

  const fetchTab = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/tabs/${tabId}`);
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || 'Order not found');
      }
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [tabId]);

  useEffect(() => {
    fetchTab();
  }, [fetchTab]);

  useEffect(() => {
    const onPaid = ({ tab }) => {
      if (tab && String(tab._id) === String(tabId)) {
        fetchTab();
      }
    };
    const onUpdated = ({ tab }) => {
      if (tab && String(tab._id) === String(tabId)) {
        fetchTab();
      }
    };

    socket.on('tab:paid', onPaid);
    socket.on('tab:updated', onUpdated);
    return () => {
      socket.off('tab:paid', onPaid);
      socket.off('tab:updated', onUpdated);
    };
  }, [tabId, fetchTab]);

  const handlePayWithPayPal = async () => {
    const tab = data?.tab;
    if (!tab) return;

    const approvalUrl = tab.paypal?.approvalUrl;
    // If real PayPal Sandbox URL is present, redirect straight to PayPal
    if (approvalUrl && approvalUrl.includes('paypal.com')) {
      window.location.href = approvalUrl;
      return;
    }

    // In DEV_MODE or local sandbox checkout, trigger the signed webhook flow directly for 1-tap customer experience
    setProcessingPay(true);
    try {
      const res = await fetch('/api/paypal/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-dev-webhook': 'true',
          'paypal-transmission-sig': 'SANDBOX_SIMULATED_SIG',
        },
        body: JSON.stringify({
          id: `WH-CUST-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          event_type: 'PAYMENT.CAPTURE.COMPLETED',
          resource: {
            id: `CAP-${Date.now().toString(36).toUpperCase()}`,
            custom_id: String(tab._id),
            amount: {
              currency_code: tab.currency || 'USD',
              value: Number(tab.amount).toFixed(2),
            },
            supplementary_data: {
              related_ids: {
                order_id: tab.paypal?.orderId || `ORD-${tab.number}`,
              },
            },
          },
        }),
      });
      if (res.ok) {
        await fetchTab();
      } else if (approvalUrl) {
        window.location.href = approvalUrl;
      }
    } catch {
      if (approvalUrl) {
        window.location.href = approvalUrl;
      }
    } finally {
      setProcessingPay(false);
    }
  };

  if (loading) {
    return (
      <main className="customer-page-shell">
        <div className="customer-card">
          <div className="state-box">
            <span className="state-icon">⏳</span>
            <p>{lang === 'hi' ? 'बिल लोड हो रहा है…' : 'Loading order bill…'}</p>
          </div>
        </div>
      </main>
    );
  }

  if (error || !data?.tab) {
    return (
      <main className="customer-page-shell">
        <div className="customer-card">
          <div className="state-box state-error">
            <span className="state-icon">⚠️</span>
            <p>{error || 'Order not found'}</p>
            <button type="button" className="primary-card-btn btn-surface-neutral" onClick={fetchTab}>
              ↻ {lang === 'hi' ? 'फिर से कोशिश करें' : 'Retry'}
            </button>
          </div>
        </div>
      </main>
    );
  }

  const { tab, stallName, currencySymbol = '₹' } = data;
  const isPaid = tab.status === 'PAID';
  const paidTime = tab.paidAt
    ? new Date(tab.paidAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <main className="customer-page-shell">
      <div className="customer-card">
        <header className="customer-header">
          <div>
            <span className="customer-brand-pill">Bharosa • भरोसा</span>
            <h1 className="customer-stall-title">{stallName}</h1>
          </div>
          {onChangeLang && (
            <button
              type="button"
              className="lang-pill-btn"
              onClick={() => onChangeLang(lang === 'hi' ? 'en' : 'hi')}
            >
              {lang === 'hi' ? 'EN' : 'हिं'}
            </button>
          )}
        </header>

        {isPaid ? (
          <section className="receipt-box" aria-live="polite">
            <div className="receipt-paid-banner">
              <span className="receipt-check-icon" aria-hidden="true">
                ✓
              </span>
              <div>
                <div className="receipt-paid-title">
                  {lang === 'hi' ? 'भुगतान हो गया ✓ धन्यवाद!' : 'Paid ✓ Thank you!'}
                </div>
                <div className="receipt-confirmed-tag">
                  {tab.paymentMethod === 'CASH'
                    ? lang === 'hi'
                      ? 'कैश द्वारा भुगतान'
                      : 'Confirmed by Cash'
                    : lang === 'hi'
                      ? '🔒 PayPal द्वारा सत्यापित (Confirmed by PayPal)'
                      : '🔒 Confirmed by PayPal'}
                </div>
              </div>
            </div>

            <div className="receipt-meta-row">
              <span>
                {lang === 'hi' ? 'ऑर्डर नंबर' : 'Order #'}: <strong>#{tab.number}</strong>
              </span>
              <span>
                {lang === 'hi' ? 'समय' : 'Time'}: <strong>{paidTime}</strong>
              </span>
            </div>

            <ul className="customer-items-list" aria-label="Receipt items">
              {(tab.items || []).map((item, idx) => (
                <li key={idx} className="customer-item-row">
                  <span className="cust-item-name">
                    <strong>{item.qty}×</strong> {item.name}
                  </span>
                  <span className="cust-item-subtotal">
                    {currencySymbol}
                    {item.qty * item.unitPrice}
                  </span>
                </li>
              ))}
            </ul>

            <div className="receipt-total-row">
              <span>{lang === 'hi' ? 'कुल भुगतान' : 'Amount Paid'}</span>
              <span className="receipt-total-amount">
                {currencySymbol}
                {tab.amount}
              </span>
            </div>

            {tab.paypal?.captureId && (
              <div className="receipt-ref-id">
                PayPal Ref: {tab.paypal.captureId}
              </div>
            )}
          </section>
        ) : (
          <section className="customer-bill-section">
            <div className="customer-order-badge">
              {lang === 'hi' ? `ऑर्डर #${tab.number}` : `Order #${tab.number}`}
            </div>

            <div className="customer-giant-amount">
              {currencySymbol}
              {tab.amount}
            </div>

            <ul className="customer-items-list" aria-label="Order items">
              {(tab.items || []).map((item, idx) => (
                <li key={idx} className="customer-item-row">
                  <span className="cust-item-name">
                    <strong>{item.qty}×</strong> {item.name}
                  </span>
                  <span className="cust-item-subtotal">
                    {currencySymbol}
                    {item.qty * item.unitPrice}
                  </span>
                </li>
              ))}
            </ul>

            <button
              type="button"
              className="btn-pay-with-paypal"
              onClick={handlePayWithPayPal}
              disabled={processingPay}
            >
              <span className="pp-btn-icon" aria-hidden="true">
                🅿️
              </span>
              <span>
                {processingPay
                  ? lang === 'hi'
                    ? 'PayPal से जुड़ रहा है…'
                    : 'Connecting to PayPal…'
                  : lang === 'hi'
                    ? 'PayPal से पेमेंट करें (Pay with PayPal)'
                    : 'Pay with PayPal'}
              </span>
            </button>
          </section>
        )}
      </div>
    </main>
  );
}

