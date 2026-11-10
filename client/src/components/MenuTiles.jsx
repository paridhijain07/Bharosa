import React from 'react';
import { t } from '../lib/i18n.js';

const ITEM_EMOJIS = {
  Chaat: '🍲',
  Chai: '☕',
  Samosa: '🥟',
  Lassi: '🥛',
  'Vada Pav': '🍔',
  Kachori: '🍘',
};

/**
 * MenuTiles (Add by tap / 1-tap voice confirmation fallback):
 * Grid of large tiles from the vendor menu: emoji, name, price, and + / - counter.
 * Sticky footer shows running total and a big "Create order" button (minimum 56px tap target).
 */
export default function MenuTiles({
  builderModal,
  setBuilderModal,
  customers = [],
  currencySymbol = '₹',
  lang = 'hi',
  isProcessing = false,
  onSubmit,
  onClose,
}) {
  if (!builderModal) return null;

  const runningTotal = (builderModal.menu || []).reduce((sum, item) => {
    const qty = builderModal.counts[item.name] || 0;
    return sum + qty * item.price;
  }, 0);

  const totalItemsCount = Object.values(builderModal.counts || {}).reduce(
    (s, q) => s + q,
    0
  );

  const increment = (name, delta) => {
    setBuilderModal((prev) => ({
      ...prev,
      counts: {
        ...prev.counts,
        [name]: Math.max(0, (prev.counts[name] || 0) + delta),
      },
    }));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="menu-tiles-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={builderModal.title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-header">
          <h2 className="sheet-title">{builderModal.title}</h2>
          <button
            type="button"
            className="btn-circle-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="menu-tiles-grid">
          {(builderModal.menu || []).map((item) => {
            const qty = builderModal.counts[item.name] || 0;
            const emoji = item.emoji || ITEM_EMOJIS[item.name] || '🍲';
            return (
              <div
                key={item.name}
                className={`menu-tile ${qty > 0 ? 'menu-tile-selected' : ''}`}
              >
                <div className="menu-tile-top" onClick={() => increment(item.name, 1)}>
                  <span className="menu-tile-emoji" aria-hidden="true">
                    {emoji}
                  </span>
                  <div className="menu-tile-meta">
                    <span className="menu-tile-name">{item.name}</span>
                    <span className="menu-tile-price">
                      {currencySymbol}
                      {item.price}
                    </span>
                  </div>
                </div>

                <div className="menu-tile-stepper">
                  <button
                    type="button"
                    className="stepper-btn stepper-minus"
                    onClick={() => increment(item.name, -1)}
                    aria-label={`Decrease ${item.name}`}
                  >
                    −
                  </button>
                  <span className="stepper-count">{qty}</span>
                  <button
                    type="button"
                    className="stepper-btn stepper-plus"
                    onClick={() => increment(item.name, 1)}
                    aria-label={`Increase ${item.name}`}
                  >
                    +
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {!builderModal.editingTabId && (
          <div className="sheet-mode-selector">
            <button
              type="button"
              className={`mode-toggle-btn ${builderModal.mode === 'PAY_NOW' ? 'mode-active-pay' : ''}`}
              onClick={() => setBuilderModal((prev) => ({ ...prev, mode: 'PAY_NOW' }))}
            >
              📱 {t(lang, 'payNowMode')}
            </button>
            <button
              type="button"
              className={`mode-toggle-btn ${builderModal.mode === 'KHATA' ? 'mode-active-khata' : ''}`}
              onClick={() => setBuilderModal((prev) => ({ ...prev, mode: 'KHATA' }))}
            >
              📓 {t(lang, 'khataMode')}
            </button>
          </div>
        )}

        {builderModal.mode === 'KHATA' && !builderModal.editingTabId && (
          <div className="sheet-customer-row">
            <span className="sheet-cust-label">{t(lang, 'selectCustomer')}:</span>
            <div className="sheet-cust-chips">
              {customers.map((c) => (
                <button
                  key={c._id}
                  type="button"
                  className={`cust-chip-btn ${builderModal.customerId === c._id ? 'cust-chip-active' : ''}`}
                  onClick={() =>
                    setBuilderModal((prev) => ({
                      ...prev,
                      customerId: c._id,
                      customerName: c.name,
                    }))
                  }
                >
                  👤 {c.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="sheet-sticky-footer">
          <div className="footer-total-box">
            <span className="footer-total-label">{t(lang, 'runningTotal')}</span>
            <span className="footer-total-amount">
              {currencySymbol}
              {runningTotal}
            </span>
          </div>

          <button
            type="button"
            className="btn-create-order"
            disabled={isProcessing || totalItemsCount === 0}
            onClick={onSubmit}
          >
            ✓ {t(lang, 'createOrder')} ({totalItemsCount})
          </button>
        </div>
      </div>
    </div>
  );
}

