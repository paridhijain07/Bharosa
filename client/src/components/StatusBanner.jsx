import React from 'react';
import { t } from '../lib/i18n.js';

/**
 * StatusBanner (the "Stall Light")
 * - Full-width sticky banner at the top of the screen.
 * - Green "All paid ✓ / सब भुगतान हो गया ✓" when no tabs are alerting.
 * - Blinking red "🚨 N unpaid / 🚨 N भुगतान बाकी" when any tab is alerting.
 * - Shows ONLY counts, never customer identity.
 * - Includes live connection dot + "Offline, reconnecting…" banner when socket drops.
 */
export default function StatusBanner({
  alertingCount = 0,
  openCount = 0,
  isConnected = true,
  lang = 'hi',
}) {
  const isAlerting = alertingCount > 0;
  const label = isAlerting
    ? t(lang, 'unpaidAlertCount')(alertingCount)
    : t(lang, 'allPaid');

  return (
    <div className="stall-light-wrapper">
      {!isConnected && (
        <div className="offline-reconnect-bar" role="alert">
          <span className="conn-dot conn-dot-offline" aria-hidden="true" />
          <span>{t(lang, 'offlineReconnecting')}</span>
        </div>
      )}

      <div
        className={`status-banner ${isAlerting ? 'banner-alerting' : 'banner-clear'}`}
        role="status"
        aria-live="assertive"
      >
        <div className="banner-main-text">
          <span>{label}</span>
        </div>

        <div className="banner-right-meta">
          {openCount > 0 && !isAlerting && (
            <span className="banner-open-pill">
              ⏳ {openCount} {lang === 'hi' ? 'खुले' : 'open'}
            </span>
          )}
          <span
            className={`conn-dot ${isConnected ? 'conn-dot-online' : 'conn-dot-offline'}`}
            title={isConnected ? t(lang, 'onlineConnected') : t(lang, 'offlineReconnecting')}
            aria-label={isConnected ? t(lang, 'onlineConnected') : t(lang, 'offlineReconnecting')}
          />
        </div>
      </div>
    </div>
  );
}
