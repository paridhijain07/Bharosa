import React, { useState, useEffect, useRef } from 'react';
import {
  QrCode,
  Banknote,
  MoreHorizontal,
  Edit3,
  RotateCcw,
  MessageCircle,
  X,
  ExternalLink,
  Zap,
  Clock,
  User,
} from 'lucide-react';
import StatusChip from './StatusChip.jsx';
import CountdownRing from './CountdownRing.jsx';
import { t } from '../lib/i18n.js';

const DEFAULT_EMOJI_MAP = {
  chaat: '🍲',
  chai: '☕',
  samosa: '🥟',
  lassi: '🥛',
  'vada pav': '🍔',
  kachori: '🍘',
};

function formatRelativeTime(createdAt, lang = 'hi', nowMs = Date.now()) {
  if (!createdAt) return '';
  const diffSec = Math.max(0, Math.floor((nowMs - new Date(createdAt).getTime()) / 1000));
  if (diffSec < 45) {
    return lang === 'hi' ? 'अभी' : 'Just now';
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return lang === 'hi' ? `${diffMin} मि॰ पहले` : `${diffMin} min ago`;
  }
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) {
    return lang === 'hi' ? `${diffHr} घं॰ पहले` : `${diffHr} hr ago`;
  }
  const diffDays = Math.floor(diffHr / 24);
  return lang === 'hi' ? `${diffDays} दिन पहले` : `${diffDays}d ago`;
}

export default function TabCard({
  tab,
  menu = [],
  currencySymbol = '₹',
  alertSeconds = 30,
  lang = 'hi',
  compact = false,
  onShowQr,
  onMarkCash,
  onCorrectOrder,
  onCancelTab,
  onRemindKhata,
  onRefundTab,
  onSimulatePay,
  devMode = false,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [expandedFromCompact, setExpandedFromCompact] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [statusHighlight, setStatusHighlight] = useState(false);
  const prevStatusRef = useRef(tab.status);

  // Touch swipe state (Part A4: Swipe right = Cash, Swipe left = Cancel)
  const touchStartXRef = useRef(null);
  const touchStartYRef = useRef(null);
  const [swipeDx, setSwipeDx] = useState(0);

  // Update relative time every 30 seconds (Part A4)
  useEffect(() => {
    const interval = setInterval(() => {
      setNowMs(Date.now());
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  // Short highlight pulse when card changes status (Part A4)
  useEffect(() => {
    if (prevStatusRef.current && prevStatusRef.current !== tab.status) {
      prevStatusRef.current = tab.status;
      setStatusHighlight(true);
      const timer = setTimeout(() => setStatusHighlight(false), 1100);
      return () => clearTimeout(timer);
    }
    prevStatusRef.current = tab.status;
    return undefined;
  }, [tab.status]);

  const statusTone =
    {
      OPEN: 'tone-open',
      PAID: 'tone-paid',
      ALERTED: 'tone-alert',
      KHATA: 'tone-khata',
      PARTIAL: 'tone-open',
      REFUNDED: 'tone-neutral',
      CANCELLED: 'tone-neutral',
    }[tab.status] || 'tone-open';

  const isUnpaidActive = ['OPEN', 'ALERTED', 'PARTIAL'].includes(tab.status);
  const showCountdown = ['OPEN', 'ALERTED'].includes(tab.status) && tab.mode === 'PAY_NOW';

  const getItemEmoji = (itemName, itemEmoji) => {
    if (itemEmoji) return itemEmoji;
    const key = String(itemName || '').toLowerCase().trim();
    const fromMenu = (menu || []).find((m) => String(m.name).toLowerCase() === key);
    if (fromMenu?.emoji) return fromMenu.emoji;
    return DEFAULT_EMOJI_MAP[key] || '🍽️';
  };

  // Touch handlers for swipe right = Cash, swipe left = Cancel
  const handleTouchStart = (e) => {
    if (!isUnpaidActive) return;
    const touch = e.touches?.[0];
    if (!touch) return;
    touchStartXRef.current = touch.clientX;
    touchStartYRef.current = touch.clientY;
  };

  const handleTouchMove = (e) => {
    if (!isUnpaidActive || touchStartXRef.current === null) return;
    const touch = e.touches?.[0];
    if (!touch) return;
    const dx = touch.clientX - touchStartXRef.current;
    const dy = touch.clientY - (touchStartYRef.current || 0);
    if (Math.abs(dy) > Math.abs(dx)) return; // vertical scroll
    const clamped = Math.max(-110, Math.min(110, dx));
    setSwipeDx(clamped);
  };

  const handleTouchEnd = () => {
    if (!isUnpaidActive || touchStartXRef.current === null) {
      setSwipeDx(0);
      return;
    }
    const finalDx = swipeDx;
    touchStartXRef.current = null;
    touchStartYRef.current = null;
    setSwipeDx(0);

    if (finalDx >= 72) {
      onMarkCash?.(tab._id);
    } else if (finalDx <= -72) {
      onCancelTab?.(tab._id, tab);
    }
  };

  const relativeTimeLabel = formatRelativeTime(tab.createdAt, lang, nowMs);

  const itemsSummaryText = (tab.items || [])
    .map((item) => `${getItemEmoji(item.name, item.emoji)} ${item.qty}× ${item.name}`)
    .join(', ');

  if (compact && !expandedFromCompact && !isUnpaidActive && tab.status !== 'KHATA') {
    return (
      <article
        className={`tab-card-compact ${statusTone} ${statusHighlight ? 'tab-card-status-flash' : ''}`}
        onClick={() => setExpandedFromCompact(true)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setExpandedFromCompact(true);
          }
        }}
        title={lang === 'hi' ? 'विवरण देखने के लिए टैप करें' : 'Tap to expand order details'}
      >
        <div className="tab-compact-left">
          <span className="tab-compact-num">#{tab.number}</span>
          <span className="tab-compact-items">{itemsSummaryText}</span>
        </div>
        <div className="tab-compact-right">
          {relativeTimeLabel && <span className="tab-compact-time">{relativeTimeLabel}</span>}
          <span className="tab-compact-amount">
            {currencySymbol}
            {tab.amount}
          </span>
          <StatusChip status={tab.status} lang={lang} />
        </div>
      </article>
    );
  }

  return (
    <div className="tab-card-swipe-wrap">
      {isUnpaidActive && swipeDx !== 0 && (
        <div
          className={`swipe-hint-bg ${swipeDx > 0 ? 'swipe-bg-cash' : 'swipe-bg-cancel'}`}
          aria-hidden="true"
        >
          {swipeDx > 0 ? (
            <span>
              <Banknote size={18} /> {t(lang, 'cashBtn')}
            </span>
          ) : (
            <span>
              <X size={18} /> {t(lang, 'cancelBtn')}
            </span>
          )}
        </div>
      )}

      <article
        className={`tab-card ${statusTone} ${statusHighlight ? 'tab-card-status-flash' : ''}`}
        style={
          swipeDx !== 0
            ? { transform: `translateX(${swipeDx}px)`, transition: 'none' }
            : undefined
        }
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="tab-card-top">
          <div className="tab-order-heading">
            <span className="tab-order-num">#{tab.number}</span>
            {relativeTimeLabel && (
              <span className="tab-relative-time" title={new Date(tab.createdAt).toLocaleTimeString()}>
                <Clock size={13} aria-hidden="true" /> {relativeTimeLabel}
              </span>
            )}
            {tab.customerId?.name && (
              <span className="tab-customer-chip">
                <User size={14} aria-hidden="true" /> {tab.customerId.name}
              </span>
            )}
          </div>

          <div className="tab-top-right">
            {showCountdown && (
              <CountdownRing
                createdAt={tab.createdAt}
                alertSeconds={tab.alertAfterSeconds || alertSeconds}
                status={tab.status}
              />
            )}
            <StatusChip status={tab.status} lang={lang} />
            {compact && expandedFromCompact && (
              <button
                type="button"
                className="tab-collapse-btn"
                onClick={() => setExpandedFromCompact(false)}
                title={lang === 'hi' ? 'छोटा करें' : 'Collapse'}
              >
                ▴
              </button>
            )}
          </div>
        </div>

        <div className="tab-card-body">
          <div className="tab-items-list">
            {(tab.items || []).map((item, idx) => (
              <span key={idx} className="tab-item-tag">
                <span className="tab-item-emoji" aria-hidden="true">
                  {getItemEmoji(item.name, item.emoji)}
                </span>{' '}
                <strong>{item.qty}×</strong> {item.name}
              </span>
            ))}
          </div>

          <div className="tab-amount-display">
            {currencySymbol}
            {tab.amount}
          </div>
        </div>

        <div className="tab-card-actions">
          {isUnpaidActive && (
            <>
              <button
                type="button"
                className="primary-card-btn btn-surface-qr"
                onClick={() => onShowQr(tab)}
              >
                <QrCode size={20} aria-hidden="true" /> {t(lang, 'qrBtn')}
              </button>

              <button
                type="button"
                className="primary-card-btn btn-surface-cash"
                onClick={() => onMarkCash(tab._id)}
              >
                <Banknote size={20} aria-hidden="true" /> {t(lang, 'cashBtn')}
              </button>
            </>
          )}

          {tab.status === 'KHATA' && (
            <>
              <button
                type="button"
                className="primary-card-btn btn-surface-khata"
                onClick={() => onRemindKhata(tab._id)}
              >
                <MessageCircle size={20} aria-hidden="true" /> {t(lang, 'remindWhatsappBtn')}
              </button>

              <button
                type="button"
                className="primary-card-btn btn-surface-cash"
                onClick={() => onMarkCash(tab._id)}
              >
                <Banknote size={20} aria-hidden="true" /> {t(lang, 'cashBtn')}
              </button>
            </>
          )}

          <div className="overflow-menu-wrap">
            <button
              type="button"
              className="btn-overflow-trigger"
              aria-label={lang === 'hi' ? 'अधिक विकल्प' : 'More actions'}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <MoreHorizontal size={22} />
            </button>

            {menuOpen && (
              <div className="overflow-dropdown" role="menu">
                {isUnpaidActive && (
                  <button
                    type="button"
                    role="menuitem"
                    className="overflow-item"
                    onClick={() => {
                      setMenuOpen(false);
                      onCorrectOrder(tab);
                    }}
                  >
                    <Edit3 size={17} /> {t(lang, 'editBtn')}
                  </button>
                )}

                {tab.status === 'KHATA' && (
                  <button
                    type="button"
                    role="menuitem"
                    className="overflow-item"
                    onClick={() => {
                      setMenuOpen(false);
                      onShowQr(tab);
                    }}
                  >
                    <QrCode size={17} /> {t(lang, 'qrBtn')}
                  </button>
                )}

                {tab.status === 'PAID' &&
                  tab.paymentMethod === 'PAYPAL' &&
                  tab.paypal?.captureId && (
                    <button
                      type="button"
                      role="menuitem"
                      className="overflow-item overflow-danger"
                      onClick={() => {
                        setMenuOpen(false);
                        onRefundTab(tab._id);
                      }}
                    >
                      <RotateCcw size={17} /> {t(lang, 'refundBtn')}
                    </button>
                  )}

                {isUnpaidActive && (
                  <button
                    type="button"
                    role="menuitem"
                    className="overflow-item overflow-danger"
                    onClick={() => {
                      setMenuOpen(false);
                      onCancelTab(tab._id, tab);
                    }}
                  >
                    <X size={17} /> {t(lang, 'cancelBtn')}
                  </button>
                )}

                {devMode && tab.status !== 'PAID' && (
                  <button
                    type="button"
                    role="menuitem"
                    className="overflow-item"
                    onClick={() => {
                      setMenuOpen(false);
                      onSimulatePay(tab._id);
                    }}
                  >
                    <Zap size={17} />{' '}
                    {lang === 'hi' ? 'डेमो पेमेंट (PayPal)' : 'Simulate PayPal Pay'}
                  </button>
                )}

                <a
                  href={`/pay/${tab._id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="overflow-item"
                  onClick={() => setMenuOpen(false)}
                >
                  <ExternalLink size={17} />{' '}
                  {lang === 'hi' ? 'ग्राहक पेज (/pay)' : 'Customer Page (/pay)'}
                </a>
              </div>
            )}
          </div>
        </div>
      </article>
    </div>
  );
}
