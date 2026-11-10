import React, { useEffect, useState } from 'react';
import {
  Check,
  Edit3,
  X,
  User,
  AlertTriangle,
  Sparkles,
  Mic,
} from 'lucide-react';
import {
  speakText,
  isSpeechRecognitionSupported,
  startSpeechRecognition,
} from '../lib/speech.js';

const ITEM_EMOJIS = {
  Chaat: '🍲',
  Chai: '☕',
  Samosa: '🥟',
  Lassi: '🥛',
  'Vada Pav': '🍔',
  Kachori: '🍘',
};

/**
 * ConfirmationCard (Part A2, B3, B4):
 * Shown after voice recognition ends:
 * - Parsed items as large chips with +/- counters
 * - Running total
 * - Optional customer chip + mode toggle (Pay now / Khata)
 * - "Raju's usual" badge when resolved from usual history (B3)
 * - Highlighted uncertain item + 1-line reason ("Not on menu" or "Not sure") when `needsConfirmation` is true
 * - Soft credit-limit warning ("This is above Raju's limit of ₹300") when a new Khata tab exceeds the customer's limit (B4)
 * - Speaks short confirmation ("2 Chaat, 80 rupees. Confirm?") and accepts spoken "haan"/"yes" to confirm
 */
export default function ConfirmationCard({
  cardState,
  setCardState,
  customers = [],
  menu = [],
  currencySymbol = '₹',
  lang = 'hi',
  isProcessing = false,
  onConfirm,
  onEditInMenuTiles,
  onCancel,
}) {
  const [voiceConfirmListening, setVoiceConfirmListening] = useState(false);

  useEffect(() => {
    if (!cardState) return undefined;

    const validItems = (cardState.items || []).filter((i) => !i.unmatched && i.qty > 0);
    const total = validItems.reduce((s, i) => s + i.qty * (i.unitPrice || 0), 0);

    if (validItems.length > 0) {
      const itemsSpoken = validItems.map((i) => `${i.qty} ${i.name}`).join(', ');
      const promptText =
        lang === 'hi'
          ? `${itemsSpoken}, ${total} रुपये। कन्फर्म करें?`
          : `${itemsSpoken}, ${total} rupees. Confirm?`;
      speakText(promptText, lang, [100]);
    } else if (cardState.reason) {
      speakText(
        lang === 'hi'
          ? 'ऑर्डर स्पष्ट नहीं है, कृपया बदलें या पुष्टि करें।'
          : cardState.reason,
        lang,
        [150]
      );
    }

    // Feature-detect spoken "haan" / "yes" listener after prompt finishes speaking
    let rec = null;
    const timer = setTimeout(() => {
      if (!isSpeechRecognitionSupported()) return;
      try {
        setVoiceConfirmListening(true);
        rec = startSpeechRecognition({
          lang,
          interimResults: false,
          onResult: (heard) => {
            setVoiceConfirmListening(false);
            const lower = String(heard || '').toLowerCase();
            if (/\b(haan|han|ha|yes|ok|okay|confirm|sahi|हां|हाँ|जी)\b/i.test(lower)) {
              onConfirm?.();
            }
          },
          onError: () => setVoiceConfirmListening(false),
          onEnd: () => setVoiceConfirmListening(false),
        });
      } catch {
        setVoiceConfirmListening(false);
      }
    }, 1700);

    return () => {
      clearTimeout(timer);
      rec?.stop?.();
    };
  }, [cardState?.transcript]);

  if (!cardState) return null;

  const emojiLookup = Object.fromEntries(
    (menu || []).map((m) => [m.name, m.emoji || ITEM_EMOJIS[m.name] || '🍲'])
  );

  const validItems = (cardState.items || []).filter((i) => !i.unmatched && i.qty > 0);
  const unmatchedItems = (cardState.items || []).filter((i) => i.unmatched);
  const totalAmount = validItems.reduce(
    (sum, item) => sum + item.qty * (item.unitPrice || 0),
    0
  );

  const selectedCustomer = customers.find(
    (c) =>
      (cardState.customerId && String(c._id) === String(cardState.customerId)) ||
      (cardState.customerName &&
        c.name.toLowerCase() === cardState.customerName.toLowerCase())
  );

  // Part B4: Check if new Khata tab pushes outstanding balance above customer's credit limit
  const customerLimit =
    selectedCustomer?.creditLimit ??
    selectedCustomer?.creditSuggestion?.suggestedLimit ??
    null;
  const currentOwed = selectedCustomer?.outstandingBalance || 0;
  const projectedBalance = currentOwed + totalAmount;
  const isOverCreditLimit =
    cardState.mode === 'KHATA' &&
    selectedCustomer &&
    customerLimit !== null &&
    totalAmount > 0 &&
    projectedBalance > customerLimit;

  const updateItemQty = (itemName, delta) => {
    setCardState((prev) => {
      const updated = (prev.items || [])
        .map((item) => {
          if (item.name !== itemName) return item;
          const nextQty = Math.max(0, item.qty + delta);
          return { ...item, qty: nextQty };
        })
        .filter((item) => item.qty > 0 || item.unmatched);
      return { ...prev, items: updated };
    });
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="confirmation-card-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Confirm Order"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="confirm-card-header">
          <div>
            <span className="confirm-subtitle">
              {cardState.transcript
                ? `“${cardState.transcript}”`
                : lang === 'hi'
                  ? 'ऑर्डर की पुष्टि करें'
                  : 'Confirm Order'}
            </span>
            <h2 className="confirm-title">
              {lang === 'hi' ? 'क्या यह सही है?' : 'Confirm this order?'}
            </h2>
          </div>

          <button
            type="button"
            className="btn-circle-close"
            onClick={onCancel}
            aria-label="Close"
          >
            <X size={22} />
          </button>
        </div>

        {/* Part B3: "Raju's usual" badge */}
        {cardState.usual && cardState.usualFound && (
          <div className="usual-order-badge">
            <Sparkles size={18} />
            <span>
              {lang === 'hi'
                ? `${cardState.customerName || 'ग्राहक'} का रोज़ वाला ऑर्डर`
                : `${cardState.customerName || 'Customer'}'s usual`}
            </span>
          </div>
        )}

        {/* Uncertain / Needs Confirmation Warning */}
        {(cardState.needsConfirmation || unmatchedItems.length > 0) && (
          <div className="confirm-warning-banner" role="alert">
            <AlertTriangle size={20} />
            <span>
              {unmatchedItems.length > 0
                ? lang === 'hi'
                  ? `"${unmatchedItems.map((u) => u.name).join(', ')}" मेन्यू में नहीं है (Not on menu)`
                  : `"${unmatchedItems.map((u) => u.name).join(', ')}" — Not on menu`
                : cardState.reason ||
                  (lang === 'hi' ? 'पूरी तरह स्पष्ट नहीं (Not sure)' : 'Not sure — please verify')}
            </span>
          </div>
        )}

        {/* Parsed Item Chips with +/- Stepper */}
        <div className="confirm-items-list">
          {validItems.map((item) => (
            <div key={item.name} className="confirm-item-chip">
              <div className="confirm-item-left">
                <span className="confirm-item-emoji" aria-hidden="true">
                  {emojiLookup[item.name] || ITEM_EMOJIS[item.name] || '🍲'}
                </span>
                <div>
                  <div className="confirm-item-name">{item.name}</div>
                  <div className="confirm-item-price">
                    {currencySymbol}
                    {item.unitPrice} × {item.qty} ={' '}
                    <strong>
                      {currencySymbol}
                      {item.unitPrice * item.qty}
                    </strong>
                  </div>
                </div>
              </div>

              <div className="confirm-item-stepper">
                <button
                  type="button"
                  className="stepper-btn stepper-minus"
                  onClick={() => updateItemQty(item.name, -1)}
                  aria-label={`Decrease ${item.name}`}
                >
                  −
                </button>
                <span className="stepper-count">{item.qty}</span>
                <button
                  type="button"
                  className="stepper-btn stepper-plus"
                  onClick={() => updateItemQty(item.name, 1)}
                  aria-label={`Increase ${item.name}`}
                >
                  +
                </button>
              </div>
            </div>
          ))}

          {unmatchedItems.map((unk) => (
            <div
              key={unk.name}
              className="confirm-item-chip confirm-item-uncertain"
            >
              <div className="confirm-item-left">
                <AlertTriangle size={22} />
                <div>
                  <div className="confirm-item-name">{unk.name}</div>
                  <div className="confirm-uncertain-reason">
                    {lang === 'hi' ? 'मेन्यू में नहीं है (Not on menu)' : 'Not on menu'}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Mode Toggle: Pay Now vs Khata */}
        <div className="sheet-mode-selector">
          <button
            type="button"
            className={`mode-toggle-btn ${cardState.mode === 'PAY_NOW' ? 'mode-active-pay' : ''}`}
            onClick={() => setCardState((prev) => ({ ...prev, mode: 'PAY_NOW' }))}
          >
            {lang === 'hi' ? 'अभी पेमेंट (Pay Now)' : 'Pay Now (QR)'}
          </button>
          <button
            type="button"
            className={`mode-toggle-btn ${cardState.mode === 'KHATA' ? 'mode-active-khata' : ''}`}
            onClick={() =>
              setCardState((prev) => ({
                ...prev,
                mode: 'KHATA',
                customerId: prev.customerId || customers[0]?._id || null,
                customerName: prev.customerName || customers[0]?.name || 'Raju',
              }))
            }
          >
            {lang === 'hi' ? 'खाता / उधार (Khata)' : 'Khata (Credit)'}
          </button>
        </div>

        {/* Customer selector when in Khata mode or when customer was detected */}
        {(cardState.mode === 'KHATA' || cardState.customerName) && (
          <div className="sheet-customer-row">
            <div className="sheet-cust-chips">
              {customers.map((c) => {
                const isSelected =
                  (cardState.customerId && String(cardState.customerId) === String(c._id)) ||
                  (!cardState.customerId &&
                    cardState.customerName?.toLowerCase() === c.name.toLowerCase());
                return (
                  <button
                    key={c._id}
                    type="button"
                    className={`cust-chip-btn ${isSelected ? 'cust-chip-active' : ''}`}
                    onClick={() =>
                      setCardState((prev) => ({
                        ...prev,
                        customerId: c._id,
                        customerName: c.name,
                      }))
                    }
                  >
                    <User size={16} />
                    <span>{c.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Part B4: Soft Credit Limit Warning (Never blocks the vendor) */}
        {isOverCreditLimit && (
          <div className="credit-limit-soft-warning" role="status">
            <AlertTriangle size={20} />
            <span>
              {lang === 'hi'
                ? `ध्यान दें: यह ${selectedCustomer.name} की उधार सीमा (${currencySymbol}${customerLimit}) से अधिक है (कुल बकाया ${currencySymbol}${projectedBalance} होगा)।`
                : `This is above ${selectedCustomer.name}'s limit of ${currencySymbol}${customerLimit} (new balance: ${currencySymbol}${projectedBalance}).`}
            </span>
          </div>
        )}

        {/* Total + Voice "Haan/Yes" Indicator */}
        <div className="confirm-total-strip">
          <div>
            <span className="footer-total-label">
              {lang === 'hi' ? 'कुल रकम (Total)' : 'Total Amount'}
            </span>
            {voiceConfirmListening && (
              <span className="voice-yes-hint">
                <Mic size={14} />{' '}
                {lang === 'hi' ? '"हाँ" बोलें या बटन दबाएं' : 'Say "Yes" or tap Confirm'}
              </span>
            )}
          </div>
          <span className="confirm-total-number">
            {currencySymbol}
            {totalAmount}
          </span>
        </div>

        {/* Two Big Buttons: Confirm & Edit */}
        <div className="confirm-actions-grid">
          <button
            type="button"
            className="primary-card-btn btn-surface-neutral"
            onClick={onEditInMenuTiles}
          >
            <Edit3 size={22} />
            <span>{lang === 'hi' ? 'बदलें (Edit)' : 'Edit'}</span>
          </button>

          <button
            type="button"
            className="primary-card-btn btn-surface-paid"
            disabled={isProcessing || validItems.length === 0}
            onClick={onConfirm}
          >
            <Check size={24} />
            <span>{lang === 'hi' ? 'कन्फर्म (Confirm)' : 'Confirm'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

