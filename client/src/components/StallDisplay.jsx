import React, { useEffect, useState, useCallback } from 'react';
import { socket } from '../lib/socket.js';
import { requestScreenWakeLock } from '../lib/speech.js';

/**
 * StallDisplay (`/display`) — Part B2:
 * Crowd-facing second screen that updates live via Socket.IO:
 * - Huge GREEN "All paid ✓ / सब भुगतान हो गया" when there are no overdue tabs.
 * - Big blinking RED "Payment pending / भुगतान बाकी" when any tab is alerting.
 * - Shows stall name and a large "Scan to pay" hint.
 * - Privacy rule: NEVER shows customer names, amounts, or items. Counts only.
 * - Keeps the screen awake via Screen Wake Lock API and auto-reconnects.
 */
export default function StallDisplay() {
  const [stats, setStats] = useState({ alertedCount: 0, openCount: 0 });
  const [stallName, setStallName] = useState('Sharma Ji Chaat & Chai Stall');
  const [isConnected, setIsConnected] = useState(socket.connected);

  const fetchStatus = useCallback(async () => {
    try {
      const [statsRes, tabsRes] = await Promise.all([
        fetch('/api/stats/today'),
        fetch('/api/tabs?limit=5'),
      ]);
      if (statsRes.ok) {
        const s = await statsRes.json();
        setStats(s);
      }
      if (tabsRes.ok) {
        const t = await tabsRes.json();
        if (t.vendor?.name) setStallName(t.vendor.name);
      }
    } catch {
      // Auto-retry on socket reconnect
    }
  }, []);

  useEffect(() => {
    fetchStatus();

    let wakeLock = null;
    requestScreenWakeLock().then((wl) => {
      wakeLock = wl;
    });

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        requestScreenWakeLock().then((wl) => {
          wakeLock = wl;
        });
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      wakeLock?.release?.().catch(() => {});
    };
  }, [fetchStatus]);

  useEffect(() => {
    const onConnect = () => {
      setIsConnected(true);
      fetchStatus();
    };
    const onDisconnect = () => setIsConnected(false);
    const onStats = (newStats) => setStats(newStats);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('stats:updated', onStats);
    socket.on('tab:alert', fetchStatus);
    socket.on('tab:paid', fetchStatus);
    socket.on('tab:created', fetchStatus);
    socket.on('tab:updated', fetchStatus);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('stats:updated', onStats);
      socket.off('tab:alert', fetchStatus);
      socket.off('tab:paid', fetchStatus);
      socket.off('tab:created', fetchStatus);
      socket.off('tab:updated', fetchStatus);
    };
  }, [fetchStatus]);

  const alertedCount = stats.alertedCount || 0;
  const openCount = stats.openCount || 0;
  const isAlerting = alertedCount > 0;

  return (
    <main
      className={`crowd-display-screen ${isAlerting ? 'crowd-display-alert' : 'crowd-display-clear'}`}
      role="status"
      aria-live="assertive"
    >
      <header className="crowd-display-top">
        <span className="crowd-stall-name">{stallName}</span>
        <span className="crowd-conn-pill">
          <span
            className={`conn-dot ${isConnected ? 'conn-dot-online' : 'conn-dot-offline'}`}
          />
          {isConnected ? 'LIVE' : 'RECONNECTING…'}
        </span>
      </header>

      <div className="crowd-display-center">
        <div className="crowd-giant-icon" aria-hidden="true">
          {isAlerting ? '🚨' : '✓'}
        </div>

        <h1 className="crowd-primary-hi">
          {isAlerting ? 'भुगतान बाकी' : 'सब भुगतान हो गया ✓'}
        </h1>

        <h2 className="crowd-primary-en">
          {isAlerting ? 'Payment pending' : 'All paid ✓'}
        </h2>

        <div className="crowd-count-pill">
          {isAlerting
            ? `${alertedCount} अनपेड ऑर्डर • ${alertedCount} Unpaid`
            : openCount > 0
              ? `${openCount} चालू ऑर्डर • ${openCount} Open`
              : '0 बाकी • 0 Unpaid'}
        </div>
      </div>

      <footer className="crowd-display-footer">
        <span>📱 QR स्कैन करके PayPal से पेमेंट करें • Scan QR to Pay with PayPal</span>
      </footer>
    </main>
  );
}

