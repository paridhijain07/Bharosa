import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import {
  Menu,
  Sun,
  CalendarCheck,
  BarChart3,
  Monitor,
  Volume2,
  FlaskConical,
  Download,
  Bot,
  X,
  Activity,
  Clock,
  Smartphone,
  Camera,
  Store,
} from 'lucide-react';
import { socket } from './lib/socket.js';
import {
  speakText,
  playPaymentChime,
  requestScreenWakeLock,
  isSpeechRecognitionSupported,
  startSpeechRecognition,
} from './lib/speech.js';
import { t } from './lib/i18n.js';

import StatusBanner from './components/StatusBanner.jsx';
import TodayStrip from './components/TodayStrip.jsx';
import RecoveredCard from './components/RecoveredCard.jsx';
import SmartAlertTimingCard from './components/SmartAlertTimingCard.jsx';
import TabCard from './components/TabCard.jsx';
import QrView from './components/QrView.jsx';
import MenuTiles from './components/MenuTiles.jsx';
import PaymentSuccess from './components/PaymentSuccess.jsx';
import KhataView from './components/KhataView.jsx';
import MicButton from './components/MicButton.jsx';
import ListeningOverlay from './components/ListeningOverlay.jsx';
import ConfirmationCard from './components/ConfirmationCard.jsx';
import CloseDayModal from './components/CloseDayModal.jsx';
import ToastContainer from './components/ToastContainer.jsx';
import CustomerPage from './components/CustomerPage.jsx';
import StallDisplay from './components/StallDisplay.jsx';
import IncomePage from './components/IncomePage.jsx';
import JudgeSimulatorPanel from './components/JudgeSimulatorPanel.jsx';
import MenuScannerModal from './components/MenuScannerModal.jsx';
import VendorOnboardingModal from './components/VendorOnboardingModal.jsx';

export default function App() {
  const pathname = typeof window !== 'undefined' ? window.location.pathname : '/';
  const searchParams =
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;

  const [lang, setLang] = useState('hi');

  // Enable phone-style mouse click-and-drag vertical scrolling on desktop preview
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let isDown = false;
    let startY = 0;
    let scrollTarget = null;
    let startScrollTop = 0;
    let dragged = false;

    const findScrollableParent = (el) => {
      let node = el;
      while (node && node !== document.body && node !== document.documentElement) {
        const style = window.getComputedStyle(node);
        const overflowY = style.overflowY;
        if (
          (overflowY === 'auto' || overflowY === 'scroll') &&
          node.scrollHeight > node.clientHeight
        ) {
          return node;
        }
        node = node.parentElement;
      }
      return document.scrollingElement || document.documentElement;
    };

    const onMouseDown = (e) => {
      if (e.button !== 0) return;
      const tag = e.target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      isDown = true;
      dragged = false;
      startY = e.clientY;
      scrollTarget = findScrollableParent(e.target);
      startScrollTop =
        scrollTarget === document.documentElement || scrollTarget === document.body
          ? window.scrollY
          : scrollTarget.scrollTop;
    };

    const onMouseMove = (e) => {
      if (!isDown || !scrollTarget) return;
      const dy = e.clientY - startY;
      if (Math.abs(dy) > 5) {
        dragged = true;
        e.preventDefault();
        if (
          scrollTarget === document.documentElement ||
          scrollTarget === document.body
        ) {
          window.scrollTo(0, startScrollTop - dy);
        } else {
          scrollTarget.scrollTop = startScrollTop - dy;
        }
      }
    };

    const onMouseUp = () => {
      isDown = false;
      scrollTarget = null;
    };

    const onClickCapture = (e) => {
      if (dragged) {
        e.stopPropagation();
        e.preventDefault();
        dragged = false;
      }
    };

    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove, { passive: false });
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('click', onClickCapture, true);

    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('click', onClickCapture, true);
    };
  }, []);

  // Route dispatch for /display, /income, /income/public/:token, and /pay/:tabId
  if (pathname === '/display') {
    return <StallDisplay />;
  }

  if (pathname === '/income' || pathname.startsWith('/income/public/')) {
    const tokenFromPath = pathname.startsWith('/income/public/')
      ? pathname.replace('/income/public/', '').trim()
      : searchParams?.get('token') || null;
    return (
      <IncomePage
        publicToken={tokenFromPath}
        lang={lang}
        onChangeLang={setLang}
      />
    );
  }

  if (pathname.startsWith('/pay/')) {
    const tabId = pathname.replace('/pay/', '').split('/')[0];
    return (
      <CustomerPage
        tabId={tabId}
        lang={lang}
        onChangeLang={setLang}
      />
    );
  }

  return <VendorHomeScreen lang={lang} setLang={setLang} />;
}

function VendorHomeScreen({ lang, setLang }) {
  const [activeView, setActiveView] = useState('tabs'); // 'tabs' | 'khata'
  const [tabs, setTabs] = useState([]);
  const [vendor, setVendor] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [todayStats, setTodayStats] = useState({
    collected: 0,
    pending: 0,
    khata: 0,
    openCount: 0,
    alertedCount: 0,
  });
  const [recoveredStats, setRecoveredStats] = useState(null);
  const [currencySymbol, setCurrencySymbol] = useState('₹');
  const [alertSeconds, setAlertSeconds] = useState(30);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [isConnected, setIsConnected] = useState(socket.connected);

  const [activeQrTab, setActiveQrTab] = useState(null);
  const [paidOverlay, setPaidOverlay] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorBanner, setErrorBanner] = useState(null);
  const [lastReminderInfo, setLastReminderInfo] = useState(null);
  const [builderModal, setBuilderModal] = useState(null);
  const [reconcilePrompt, setReconcilePrompt] = useState(null);
  const [closeDayOpen, setCloseDayOpen] = useState(false);
  const [smartTimingModalOpen, setSmartTimingModalOpen] = useState(false);
  const [judgeSplitOpen, setJudgeSplitOpen] = useState(false);
  const [menuScannerOpen, setMenuScannerOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(() => {
    try {
      return localStorage.getItem('bharosa_onboarded') !== '1';
    } catch {
      return false;
    }
  });
  const [scannerInitialMode, setScannerInitialMode] = useState('menu');
  const [pitchResetting, setPitchResetting] = useState(false);
  const [activeTourStep, setActiveTourStep] = useState(0);
  const [orderFilter, setOrderFilter] = useState('smart'); // 'smart' | 'unpaid' | 'completed'
  const [showAllCompleted, setShowAllCompleted] = useState(false);

  // Part A2: Listening overlay & ConfirmationCard states
  const [listeningOpen, setListeningOpen] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [confirmationOrder, setConfirmationOrder] = useState(null);
  const recognitionRef = useRef(null);

  // Assistant answer card state
  const [assistantCard, setAssistantCard] = useState(null);

  // Part A5: Toasts & Activity Feed
  const [toasts, setToasts] = useState([]);
  const [activityFeed, setActivityFeed] = useState([]);

  // Header menu, Demo toggle, Sunlight mode, PWA install prompt
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [showDemoDrawer, setShowDemoDrawer] = useState(false);
  const [sunlightMode, setSunlightMode] = useState(() => {
    try {
      return localStorage.getItem('bharosa_sunlight_mode') === '1';
    } catch {
      return false;
    }
  });
  const [installPromptEvent, setInstallPromptEvent] = useState(null);

  // Apply sunlight high-contrast mode to body (Part A5)
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (sunlightMode) {
      document.body.classList.add('sunlight-mode');
    } else {
      document.body.classList.remove('sunlight-mode');
    }
    try {
      localStorage.setItem('bharosa_sunlight_mode', sunlightMode ? '1' : '0');
    } catch {
      // ignore storage error
    }
  }, [sunlightMode]);

  const addToast = useCallback((message, tone = 'paid', extra = {}) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const duration = extra.onUndo ? 5200 : 3800;
    setToasts((prev) => [{ id, message, tone, ...extra }, ...prev.slice(0, 3)]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, duration);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const pushActivity = useCallback((textHi, textEn, tone = 'info') => {
    setActivityFeed((prev) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        textHi,
        textEn,
        tone,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      },
      ...prev.slice(0, 7),
    ]);
  }, []);

  const fetchAllData = useCallback(async () => {
    setLoadError(null);
    try {
      const [tabsRes, custRes, statsRes, recRes] = await Promise.all([
        fetch('/api/tabs'),
        fetch('/api/customers'),
        fetch('/api/stats/today'),
        fetch('/api/stats/recovered?days=7').catch(() => null),
      ]);

      if (!tabsRes.ok) {
        throw new Error('Could not load stall orders');
      }

      const tabsData = await tabsRes.json();
      setTabs(tabsData.tabs || []);
      setVendor(tabsData.vendor || null);
      if (tabsData.currencySymbol) setCurrencySymbol(tabsData.currencySymbol);
      if (tabsData.alertSeconds) setAlertSeconds(Number(tabsData.alertSeconds));

      if (custRes.ok) {
        const cData = await custRes.json();
        setCustomers(cData.customers || []);
      }

      if (statsRes.ok) {
        const sData = await statsRes.json();
        setTodayStats(sData);
      }

      if (recRes && recRes.ok) {
        const rData = await recRes.json();
        setRecoveredStats(rData);
      }
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAllData();
  }, [fetchAllData]);

  // Screen Wake Lock + PWA beforeinstallprompt listener
  useEffect(() => {
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

    const onBeforeInstall = (e) => {
      e.preventDefault();
      setInstallPromptEvent(e);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      wakeLock?.release?.().catch(() => {});
    };
  }, []);

  // Socket.IO live listeners
  useEffect(() => {
    const onConnect = () => {
      setIsConnected(true);
      fetchAllData();
    };
    const onDisconnect = () => setIsConnected(false);

    const formatItemsText = (tab) =>
      (tab?.items || []).map((i) => `${i.qty} ${i.name}`).join(', ') || `Order #${tab?.number}`;

    const onTabCreated = ({ tab }) => {
      setTabs((prev) => {
        const exists = prev.some((item) => item._id === tab._id);
        return exists ? prev.map((item) => (item._id === tab._id ? tab : item)) : [tab, ...prev];
      });
      const itemsLabel = formatItemsText(tab);
      pushActivity(
        `#${tab.number} • ${itemsLabel} (₹${tab.amount})`,
        `#${tab.number} • ${itemsLabel} (₹${tab.amount})`,
        'open'
      );
      fetchAllData();
    };

    const onTabPaid = ({ tab, spokenEn, spokenHi }) => {
      setTabs((prev) => prev.map((item) => (item._id === tab._id ? tab : item)));
      setActiveQrTab((curr) => (curr && curr._id === tab._id ? null : curr));
      setPaidOverlay({ tab });
      playPaymentChime();
      const itemsLabel = formatItemsText(tab);
      const msg =
        lang === 'hi'
          ? spokenHi || `${itemsLabel} के ${tab.amount} रुपये मिल गए`
          : spokenEn || `${itemsLabel}, ${tab.amount} rupees received`;
      speakText(msg, lang, [180, 80, 180]);
      addToast(
        lang === 'hi'
          ? `✓ #${tab.number} (${itemsLabel}) — ${currencySymbol}${tab.amount} मिले`
          : `✓ #${tab.number} (${itemsLabel}) — ${currencySymbol}${tab.amount} received`,
        'paid'
      );
      pushActivity(
        `✓ #${tab.number} • ${itemsLabel} (${tab.paymentMethod})`,
        `✓ #${tab.number} • ${itemsLabel} (${tab.paymentMethod})`,
        'paid'
      );
      fetchAllData();
    };

    const onTabAlert = ({ tab, spokenAlertEn, spokenAlertHi }) => {
      setTabs((prev) => prev.map((item) => (item._id === tab._id ? tab : item)));
      const itemsLabel = formatItemsText(tab);
      const msg =
        lang === 'hi'
          ? spokenAlertHi || `ध्यान दें! ${itemsLabel} के ${tab.amount} रुपये नहीं मिले!`
          : spokenAlertEn || `Alert! ${itemsLabel}, ${tab.amount} rupees not paid!`;
      speakText(msg, lang, [400, 150, 400, 150, 400]);
      addToast(
        lang === 'hi'
          ? `🚨 #${tab.number} (${itemsLabel}) — ${currencySymbol}${tab.amount} अनपेड!`
          : `🚨 #${tab.number} (${itemsLabel}) — ${currencySymbol}${tab.amount} unpaid!`,
        'alert'
      );
      pushActivity(
        `🚨 #${tab.number} • ${itemsLabel} अनपेड अलर्ट`,
        `🚨 #${tab.number} • ${itemsLabel} unpaid alert`,
        'alert'
      );
      fetchAllData();
    };

    const onTabUpdated = ({ tab, spokenEn, spokenHi }) => {
      setTabs((prev) => prev.map((item) => (item._id === tab._id ? tab : item)));
      setActiveQrTab((curr) => (curr && curr._id === tab._id ? tab : curr));
      if (spokenEn || spokenHi) {
        speakText(lang === 'hi' ? spokenHi : spokenEn, lang);
      }
      fetchAllData();
    };

    const onStatsUpdated = (newStats) => {
      if (newStats) {
        setTodayStats(newStats);
        if (newStats.recovered) {
          setRecoveredStats(newStats.recovered);
        }
      }
    };

    const onReminderSent = (payload) => {
      setLastReminderInfo(payload);
      const cName = payload?.customer?.name || 'Customer';
      addToast(
        lang === 'hi'
          ? `${cName} को WhatsApp रिमाइंडर भेजा गया`
          : `Reminder sent to ${cName}`,
        'khata'
      );
      pushActivity(
        `${cName} को रिमाइंडर भेजा गया`,
        `Reminder sent to ${cName}`,
        'khata'
      );
      fetchAllData();
    };

    const onSummarySpeak = ({ spokenEn, spokenHi }) => {
      speakText(lang === 'hi' ? spokenHi : spokenEn, lang, [200]);
    };

    const onReconcilePrompt = (promptData) => {
      setReconcilePrompt(promptData);
      speakText(
        lang === 'hi' ? promptData.questionHi : promptData.questionEn,
        lang,
        [300, 100, 300]
      );
    };

    const onPromiseCreated = ({ promise, customer, spokenEn, spokenHi }) => {
      const cName = customer?.name || 'Customer';
      addToast(
        lang === 'hi'
          ? spokenHi || `${cName} ने भुगतान का वादा किया (${promise?.dueDateStr || ''})`
          : spokenEn || `${cName} promised to pay on ${promise?.dueDateStr || ''}`,
        'khata'
      );
      pushActivity(
        `${cName}: भुगतान का वादा (${promise?.dueDateStr || ''})`,
        `${cName}: Payment promise (${promise?.dueDateStr || ''})`,
        'khata'
      );
      fetchAllData();
    };

    const onPromiseUpdated = ({ promise, customer, spokenEn, spokenHi }) => {
      const cName = customer?.name || 'Customer';
      addToast(
        lang === 'hi'
          ? spokenHi || `${cName} का वादा स्टेटस: ${promise?.status}`
          : spokenEn || `${cName} promise status: ${promise?.status}`,
        promise?.status === 'BROKEN' ? 'alert' : 'paid'
      );
      fetchAllData();
    };

    const onMessageReceived = ({ customer, inboundMessage, spokenEn, spokenHi }) => {
      const cName = customer?.name || 'Customer';
      addToast(
        lang === 'hi'
          ? spokenHi || `💬 ${cName}: "${inboundMessage?.body || ''}"`
          : spokenEn || `💬 ${cName}: "${inboundMessage?.body || ''}"`,
        'khata'
      );
      pushActivity(
        `💬 ${cName}: "${(inboundMessage?.body || '').slice(0, 32)}"`,
        `💬 ${cName}: "${(inboundMessage?.body || '').slice(0, 32)}"`,
        'khata'
      );
      fetchAllData();
    };

    const onCustomerNeedsVendor = ({ customer, reason, spokenEn, spokenHi }) => {
      const cName = customer?.name || 'Customer';
      addToast(
        lang === 'hi'
          ? spokenHi || `⚠️ ${cName} को आपका ध्यान चाहिए (${reason})`
          : spokenEn || `⚠️ ${cName} needs your attention (${reason})`,
        'alert'
      );
      pushActivity(
        `⚠️ ${cName} को आपका ध्यान चाहिए`,
        `⚠️ ${cName} needs your attention`,
        'alert'
      );
      fetchAllData();
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('tab:created', onTabCreated);
    socket.on('tab:paid', onTabPaid);
    socket.on('tab:alert', onTabAlert);
    socket.on('tab:updated', onTabUpdated);
    socket.on('stats:updated', onStatsUpdated);
    socket.on('reminder:sent', onReminderSent);
    socket.on('summary:speak', onSummarySpeak);
    socket.on('reconcile:prompt', onReconcilePrompt);
    socket.on('promise:created', onPromiseCreated);
    socket.on('promise:updated', onPromiseUpdated);
    socket.on('message:received', onMessageReceived);
    socket.on('customer:needs_vendor', onCustomerNeedsVendor);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('tab:created', onTabCreated);
      socket.off('tab:paid', onTabPaid);
      socket.off('tab:alert', onTabAlert);
      socket.off('tab:updated', onTabUpdated);
      socket.off('stats:updated', onStatsUpdated);
      socket.off('reminder:sent', onReminderSent);
      socket.off('summary:speak', onSummarySpeak);
      socket.off('reconcile:prompt', onReconcilePrompt);
      socket.off('promise:created', onPromiseCreated);
      socket.off('promise:updated', onPromiseUpdated);
      socket.off('message:received', onMessageReceived);
      socket.off('customer:needs_vendor', onCustomerNeedsVendor);
    };
  }, [lang, currencySymbol, fetchAllData, addToast, pushActivity]);

  // Sort tabs: unpaid first (ALERTED -> OPEN -> PARTIAL -> KHATA), then recent PAID / REFUNDED / CANCELLED
  const sortedTabs = useMemo(() => {
    const priority = {
      ALERTED: 0,
      OPEN: 1,
      PARTIAL: 2,
      KHATA: 3,
      PAID: 4,
      REFUNDED: 5,
      CANCELLED: 6,
    };
    return [...tabs].sort((a, b) => {
      const pa = priority[a.status] ?? 9;
      const pb = priority[b.status] ?? 9;
      if (pa !== pb) return pa - pb;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [tabs]);

  const unpaidTabs = useMemo(
    () => sortedTabs.filter((tab) => ['ALERTED', 'OPEN', 'PARTIAL', 'KHATA'].includes(tab.status)),
    [sortedTabs]
  );

  const completedTabs = useMemo(
    () => sortedTabs.filter((tab) => !['ALERTED', 'OPEN', 'PARTIAL', 'KHATA'].includes(tab.status)),
    [sortedTabs]
  );

  // Create a tab on the server
  const createTabFromParsed = async ({ items, amount, mode, customerId, customerName }) => {
    setIsProcessing(true);
    setErrorBanner(null);
    try {
      const validItems = items.filter((i) => i.qty > 0 && i.unitPrice >= 0 && !i.unmatched);
      if (validItems.length === 0) {
        throw new Error(
          lang === 'hi'
            ? 'कृपया कम से कम 1 आइटम चुनें'
            : 'Please select at least 1 menu item'
        );
      }
      const computedAmount = validItems.reduce((s, i) => s + i.qty * i.unitPrice, 0);

      const res = await fetch('/api/tabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: validItems,
          amount: amount || computedAmount,
          mode: mode || 'PAY_NOW',
          customerId: customerId || null,
          customerName: customerName || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create tab');
      }

      const itemsSpoken =
        (data.tab.items || []).map((i) => `${i.qty} ${i.name}`).join(', ') ||
        `Order ${data.tab.number}`;

      if (data.tab.mode === 'KHATA') {
        const custLabel = data.tab.customerId?.name || customerName || 'Customer';
        speakText(
          lang === 'hi'
            ? `${itemsSpoken} के ${data.tab.amount} रुपये ${custLabel} के खाते में जोड़े गए`
            : `${itemsSpoken}, ${data.tab.amount} rupees added to ${custLabel}'s khata`,
          lang
        );
        addToast(
          lang === 'hi'
            ? `${custLabel} के खाते में ${itemsSpoken} (${currencySymbol}${data.tab.amount}) दर्ज`
            : `Added ${itemsSpoken} (${currencySymbol}${data.tab.amount}) to ${custLabel}'s khata`,
          'khata'
        );
        setActiveView('khata');
      } else {
        setActiveQrTab(data.tab);
        speakText(
          lang === 'hi'
            ? `${itemsSpoken}, ${data.tab.amount} रुपये`
            : `${itemsSpoken}, ${data.tab.amount} rupees`,
          lang
        );
      }

      setConfirmationOrder(null);
      setBuilderModal(null);
      fetchAllData();
    } catch (err) {
      setErrorBanner(err.message);
      speakText(err.message, lang);
    } finally {
      setIsProcessing(false);
    }
  };

  // Part A2: Parse spoken transcript and show ConfirmationCard
  const handleVoiceTranscript = async (transcript) => {
    setErrorBanner(null);
    setListeningOpen(false);
    setInterimTranscript('');

    if (!transcript || !transcript.trim()) {
      openTapBuilderModal({
        title:
          lang === 'hi'
            ? 'आवाज़ स्पष्ट नहीं थी — टैप से चुनें'
            : 'Voice unclear — Tap to select',
        transcript: '',
        items: [],
        mode: 'PAY_NOW',
        customerName: null,
      });
      return;
    }

    setIsProcessing(true);
    try {
      const res = await fetch('/api/tabs/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: transcript }),
      });
      const parsed = await res.json();

      if (!res.ok) {
        throw new Error(parsed.error || 'Parse failed');
      }

      setConfirmationOrder({
        ...parsed,
        transcript,
      });
    } catch (err) {
      setErrorBanner(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // Part A2: Start full-screen ListeningOverlay with live interim results
  const handleStartVoiceOrder = () => {
    setInterimTranscript('');
    setListeningOpen(true);

    if (!isSpeechRecognitionSupported()) {
      return;
    }

    recognitionRef.current = startSpeechRecognition({
      lang,
      onInterim: (liveText) => {
        setInterimTranscript(liveText);
      },
      onResult: (finalTranscript) => {
        if (finalTranscript && finalTranscript.trim()) {
          setListeningOpen(false);
          handleVoiceTranscript(finalTranscript);
        }
      },
      onError: () => {
        // Keep ListeningOverlay open so the user can keep speaking or tap a quick phrase
      },
      onEnd: () => {
        // Keep ListeningOverlay open until speech is recognized or user confirms/cancels
      },
    });
  };

  const handleCancelVoiceOrder = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    }
    setListeningOpen(false);
    setInterimTranscript('');
  };

  // Handle Stall Assistant voice question -> POST /api/assistant/ask
  const handleAskAssistant = async (questionText) => {
    if (!questionText || !questionText.trim()) return;
    setIsProcessing(true);
    setErrorBanner(null);
    try {
      const res = await fetch('/api/assistant/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: questionText, lang }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Assistant error');
      }
      setAssistantCard({
        question: questionText,
        ...data,
      });
      speakText(data.spokenText, lang, [120, 60, 120]);
    } catch (err) {
      setErrorBanner(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // Open MenuTiles modal
  const openTapBuilderModal = ({
    title,
    transcript = '',
    items = [],
    mode = 'PAY_NOW',
    customerName = null,
    customerId = null,
    editingTabId = null,
  }) => {
    const menu = vendor?.menu || [
      { name: 'Chaat', emoji: '🍲', price: 40 },
      { name: 'Chai', emoji: '☕', price: 20 },
      { name: 'Samosa', emoji: '🥟', price: 15 },
      { name: 'Lassi', emoji: '🥛', price: 50 },
      { name: 'Vada Pav', emoji: '🍔', price: 25 },
      { name: 'Kachori', emoji: '🍘', price: 30 },
    ];

    const counts = {};
    menu.forEach((m) => {
      const existing = items.find((i) => i.name.toLowerCase() === m.name.toLowerCase());
      counts[m.name] = existing ? existing.qty : 0;
    });

    setBuilderModal({
      title: title || (lang === 'hi' ? 'टैप से ऑर्डर बनाएं' : 'Add Order by Tap'),
      transcript,
      counts,
      mode,
      customerName: customerName || customers[0]?.name || 'Raju',
      customerId: customerId || customers[0]?._id || null,
      editingTabId,
      menu,
    });
  };

  const handleSaveBuilderModal = async () => {
    if (!builderModal) return;
    const selectedItems = builderModal.menu
      .filter((m) => (builderModal.counts[m.name] || 0) > 0)
      .map((m) => ({
        name: m.name,
        qty: builderModal.counts[m.name],
        unitPrice: m.price,
      }));

    if (selectedItems.length === 0) {
      setErrorBanner(lang === 'hi' ? 'कम से कम 1 आइटम चुनें' : 'Select at least 1 item');
      return;
    }

    const totalAmount = selectedItems.reduce((s, i) => s + i.qty * i.unitPrice, 0);

    if (builderModal.editingTabId) {
      setIsProcessing(true);
      try {
        const res = await fetch(`/api/tabs/${builderModal.editingTabId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: selectedItems, amount: totalAmount }),
        });
        const data = await res.json();
        if (res.ok) {
          setBuilderModal(null);
          if (data.tab.mode === 'PAY_NOW') {
            setActiveQrTab(data.tab);
          }
          fetchAllData();
        }
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    await createTabFromParsed({
      items: selectedItems,
      amount: totalAmount,
      mode: builderModal.mode,
      customerId: builderModal.mode === 'KHATA' ? builderModal.customerId : null,
      customerName: builderModal.mode === 'KHATA' ? builderModal.customerName : null,
    });
  };

  const handleMarkCash = async (tabId) => {
    try {
      const res = await fetch(`/api/tabs/${tabId}/cash`, { method: 'POST' });
      if (res.ok) {
        if (activeQrTab && activeQrTab._id === tabId) {
          setActiveQrTab(null);
        }
        addToast(
          lang === 'hi' ? 'कैश दर्ज किया गया ✓' : 'Cash recorded ✓',
          'paid'
        );
        fetchAllData();
      }
    } catch (err) {
      setErrorBanner(err.message);
    }
  };

  // Part A4: Cancel tab with 5s Undo toast
  const handleCancelTab = async (tabId, tabObj) => {
    const previousStatus = tabObj?.status || 'OPEN';
    const orderNum = tabObj?.number || '';
    try {
      await fetch(`/api/tabs/${tabId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'CANCELLED' }),
      });
      fetchAllData();

      addToast(
        lang === 'hi'
          ? `ऑर्डर #${orderNum} रद्द किया गया`
          : `Order #${orderNum} cancelled`,
        'info',
        {
          tabId,
          previousStatus,
          onUndo: true,
        }
      );
    } catch (err) {
      setErrorBanner(err.message);
    }
  };

  const handleUndoToast = async (toast) => {
    dismissToast(toast.id);
    if (!toast.tabId) return;
    try {
      await fetch(`/api/tabs/${toast.tabId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: toast.previousStatus || 'OPEN' }),
      });
      addToast(
        lang === 'hi' ? 'ऑर्डर वापस चालू किया गया' : 'Order restored',
        'paid'
      );
      fetchAllData();
    } catch (err) {
      setErrorBanner(err.message);
    }
  };

  const handleSimulatePay = async (tabId, customAmount = undefined) => {
    try {
      await fetch(`/api/dev/simulate-payment/${tabId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: customAmount !== undefined ? JSON.stringify({ amount: customAmount }) : undefined,
      });
    } catch (err) {
      setErrorBanner(err.message);
    }
  };

  const handleRemindKhata = async (tabId) => {
    setErrorBanner(null);
    try {
      const res = await fetch(`/api/khata/${tabId}/remind`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: lang }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Reminder failed');
      }
      setLastReminderInfo(data);
      fetchAllData();
    } catch (err) {
      setErrorBanner(err.message);
      speakText(err.message, lang);
    }
  };

  const handleRefundTab = async (tabId) => {
    try {
      const res = await fetch(`/api/tabs/${tabId}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Refund failed');
      }
      addToast(lang === 'hi' ? 'PayPal रिफंड सफल' : 'PayPal refund completed', 'info');
      fetchAllData();
    } catch (err) {
      setErrorBanner(err.message);
    }
  };

  const handleToggleConsent = async (customerId, consent) => {
    try {
      await fetch(`/api/customers/${customerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ whatsappConsent: consent }),
      });
      fetchAllData();
    } catch (err) {
      setErrorBanner(err.message);
    }
  };

  // Part B4: Update customer Smart Credit Limit
  const handleUpdateCreditLimit = async (customerId, newLimit) => {
    try {
      const res = await fetch(`/api/customers/${customerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ creditLimit: newLimit }),
      });
      if (res.ok) {
        addToast(
          lang === 'hi'
            ? `क्रेडिट लिमिट ${currencySymbol}${newLimit} सेव हो गई`
            : `Credit limit saved: ${currencySymbol}${newLimit}`,
          'paid'
        );
        fetchAllData();
      }
    } catch (err) {
      setErrorBanner(err.message);
    }
  };

  const handleInstallClick = async () => {
    if (!installPromptEvent) return;
    installPromptEvent.prompt();
    await installPromptEvent.userChoice.catch(() => {});
    setInstallPromptEvent(null);
  };

  const alertingCount =
    todayStats.alertedCount ?? tabs.filter((item) => item.status === 'ALERTED').length;
  const openCount =
    todayStats.openCount ??
    tabs.filter((item) => ['OPEN', 'ALERTED'].includes(item.status)).length;

  return (
    <div className="app-shell">
      {/* Stacked Top Toasts (Part A5) */}
      <ToastContainer
        toasts={toasts}
        onDismiss={dismissToast}
        onUndo={handleUndoToast}
        lang={lang}
      />

      {/* 1. Sticky Stall Light Banner */}
      <StatusBanner
        alertingCount={alertingCount}
        openCount={openCount}
        isConnected={isConnected}
        lang={lang}
      />

      {/* 2. Uncrowded Header (Part A1.1): Single-line stall name + Register/Switch Stall + Language Toggle & Menu button */}
      <header className="stall-header">
        <div className="brand-block">
          <h1 className="brand-title" title={vendor?.name || 'Sharma Ji Chaat & Chai Stall'}>
            {vendor?.name || 'Sharma Ji Chaat & Chai Stall'}
          </h1>
          <span className="vendor-verified-sub">
            💙 PayPal Verified • {vendor?.ownerName || 'Sharma Ji'} ({vendor?.paypalMerchantId || 'PPMERCHANT-IN'})
          </span>
        </div>

        <div className="header-controls">
          <button
            type="button"
            className="btn-register-stall-pill"
            onClick={() => setOnboardingOpen(true)}
            title="Register or Switch Vendor Stall"
          >
            <Store size={15} />{' '}
            <span>{lang === 'hi' ? 'स्टॉल रजिस्टर / बदलें' : 'Register / Switch Stall'}</span>
          </button>

          <button
            type="button"
            className="lang-pill-btn"
            onClick={() => setLang((l) => (l === 'hi' ? 'en' : 'hi'))}
            aria-label="Toggle language"
          >
            {lang === 'hi' ? 'EN' : 'हिं'}
          </button>

          <div className="header-menu-wrap">
            <button
              type="button"
              className="btn-header-menu"
              aria-label="Stall menu"
              aria-expanded={headerMenuOpen}
              onClick={() => setHeaderMenuOpen((o) => !o)}
            >
              <Menu size={24} />
            </button>

            {headerMenuOpen && (
              <div className="header-dropdown" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  className="overflow-item"
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    setCloseDayOpen(true);
                  }}
                >
                  <CalendarCheck size={18} />{' '}
                  {lang === 'hi' ? 'दिन बंद करें (Close Day)' : 'Close Day Summary'}
                </button>

                <button
                  type="button"
                  role="menuitem"
                  className="overflow-item"
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    setSmartTimingModalOpen(true);
                  }}
                >
                  <Clock size={18} />{' '}
                  {lang === 'hi'
                    ? `स्मार्ट अलर्ट समय (${alertSeconds}s)`
                    : `Smart Alert Timing (${alertSeconds}s)`}
                </button>

                <a
                  href="/income"
                  className="overflow-item"
                  role="menuitem"
                  onClick={() => setHeaderMenuOpen(false)}
                >
                  <BarChart3 size={18} />{' '}
                  {lang === 'hi' ? 'आय विवरण (/income)' : 'Income Statement (/income)'}
                </a>

                <a
                  href="/display"
                  target="_blank"
                  rel="noreferrer"
                  className="overflow-item"
                  role="menuitem"
                  onClick={() => setHeaderMenuOpen(false)}
                >
                  <Monitor size={18} />{' '}
                  {lang === 'hi' ? 'भीड़ डिस्प्ले (/display)' : 'Crowd Display (/display)'}
                </a>

                <button
                  type="button"
                  role="menuitem"
                  className="overflow-item"
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    setSunlightMode((s) => !s);
                  }}
                >
                  <Sun size={18} />{' '}
                  {lang === 'hi'
                    ? `धूप मोड (Sunlight): ${sunlightMode ? 'चालू ✓' : 'बंद'}`
                    : `Sunlight Mode: ${sunlightMode ? 'ON ✓' : 'OFF'}`}
                </button>

                <button
                  type="button"
                  role="menuitem"
                  className="overflow-item"
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    setMenuScannerOpen(true);
                  }}
                >
                  <Camera size={18} />{' '}
                  {lang === 'hi'
                    ? 'मेन्यू कार्ड / ऑर्डर स्कैन करें (AI Vision)'
                    : 'Scan Menu Card / Order Slip (AI)'}
                </button>

                <button
                  type="button"
                  role="menuitem"
                  className="overflow-item"
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    setJudgeSplitOpen((o) => !o);
                  }}
                >
                  <Smartphone size={18} />{' '}
                  {lang === 'hi'
                    ? `जज लाइव ग्राहक फ़ोन: ${judgeSplitOpen ? 'चालू ✓' : 'खोलें'}`
                    : `Judge Customer Phone: ${judgeSplitOpen ? 'ON ✓' : 'Open'}`}
                </button>

                <button
                  type="button"
                  role="menuitem"
                  className="overflow-item"
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    setShowDemoDrawer((d) => !d);
                  }}
                >
                  <FlaskConical size={18} />{' '}
                  {lang === 'hi'
                    ? `डेमो शॉर्टकट: ${showDemoDrawer ? 'चालू ✓' : 'दिखाएं'}`
                    : `Demo Shortcuts: ${showDemoDrawer ? 'ON ✓' : 'Show'}`}
                </button>

                <button
                  type="button"
                  role="menuitem"
                  className="overflow-item"
                  onClick={() => {
                    setHeaderMenuOpen(false);
                    handleAskAssistant(
                      lang === 'hi' ? 'आज कितना आया?' : 'how much was collected today?'
                    );
                  }}
                >
                  <Volume2 size={18} />{' '}
                  {lang === 'hi' ? 'आज का हिसाब सुनें' : 'Hear Today Summary'}
                </button>

                {installPromptEvent && (
                  <button
                    type="button"
                    role="menuitem"
                    className="overflow-item"
                    onClick={() => {
                      setHeaderMenuOpen(false);
                      handleInstallClick();
                    }}
                  >
                    <Download size={18} /> {t(lang, 'installApp')}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Stall Quick Controls & Feature Ribbon */}
      <section className="judge-tour-ribbon" aria-label="Stall Quick Controls">
        <div className="judge-tour-title">
          <span className="judge-tour-trophy">⚡</span>
          <strong>{lang === 'hi' ? 'स्टॉल कंट्रोल:' : 'Quick Controls:'}</strong>
        </div>

        <div className="judge-tour-steps">
          <button
            type="button"
            className="judge-tour-reset-btn"
            disabled={pitchResetting}
            onClick={async () => {
              setPitchResetting(true);
              setActiveTourStep(0);
              try {
                const res = await fetch('/api/dev/clean-slate', { method: 'POST' });
                const data = await res.json();
                await fetchAllData();
                setActiveView('tabs');
                setOrderFilter('smart');
                addToast(
                  lang === 'hi'
                    ? '✓ नया दिन शुरू — सभी पुराने ऑर्डर साफ़ (₹0)'
                    : '✓ Fresh shift started — queue cleared (₹0)',
                  'paid'
                );
                if (data.spokenHi || data.spokenEn) {
                  speakText(lang === 'hi' ? data.spokenHi : data.spokenEn, lang);
                }
              } finally {
                setPitchResetting(false);
              }
            }}
          >
            {pitchResetting
              ? '⏳...'
              : lang === 'hi'
                ? '↻ नया दिन (₹0 रीसेट)'
                : '↻ New Shift (₹0)'}
          </button>

          <button
            type="button"
            className={`judge-tour-step-pill ${activeTourStep === 6 ? 'active' : ''}`}
            onClick={() => {
              setActiveTourStep(6);
              setOnboardingOpen(true);
            }}
          >
            🏪 {lang === 'hi' ? 'स्टॉल रजिस्टर' : 'Stall Setup'}
          </button>

          <button
            type="button"
            className={`judge-tour-step-pill ${activeTourStep === 1 ? 'active' : ''}`}
            onClick={() => {
              setActiveTourStep(1);
              setScannerInitialMode('menu');
              setMenuScannerOpen(true);
            }}
          >
            📸 {lang === 'hi' ? 'मेन्यू स्कैनर (AI)' : 'Scan Menu Card'}
          </button>

          <button
            type="button"
            className={`judge-tour-step-pill ${activeTourStep === 2 ? 'active' : ''}`}
            onClick={() => {
              setActiveTourStep(2);
              setMenuScannerOpen(false);
              setActiveView('tabs');
              handleStartVoiceOrder();
            }}
          >
            🎙️ {lang === 'hi' ? 'बोलकर ऑर्डर (Voice)' : 'Voice Order AI'}
          </button>

          <button
            type="button"
            className={`judge-tour-step-pill step-fraud ${activeTourStep === 3 ? 'active' : ''}`}
            onClick={() => {
              setActiveTourStep(3);
              setScannerInitialMode('fraud');
              setMenuScannerOpen(true);
            }}
          >
            🛡️ {lang === 'hi' ? 'नकली रसीद जांच' : 'Receipt Shield'}
          </button>

          <button
            type="button"
            className={`judge-tour-step-pill ${activeTourStep === 4 ? 'active' : ''}`}
            onClick={() => {
              setActiveTourStep(4);
              setMenuScannerOpen(false);
              setJudgeSplitOpen(true);
            }}
          >
            📱 {lang === 'hi' ? 'WhatsApp AI + Split ÷2' : 'WhatsApp AI + Split ÷2'}
          </button>

          <a
            href="/income"
            className={`judge-tour-step-pill step-loan ${activeTourStep === 5 ? 'active' : ''}`}
            onClick={() => setActiveTourStep(5)}
          >
            💙 {lang === 'hi' ? 'PayPal माइक्रो-लोन' : 'PayPal Micro-Loan'}
          </a>
        </div>
      </section>

      {/* Part A3: Responsive 2-column desktop workspace (>900px) / 1-column mobile */}
      <div className="vendor-workspace-grid">
        {/* Right Column on Desktop / Top Summary on Mobile */}
        <aside className="workspace-sidebar" aria-label="Stall stats and activity">
          <TodayStrip
            stats={todayStats}
            currencySymbol={currencySymbol}
            lang={lang}
            onSelectKhata={() => setActiveView((v) => (v === 'khata' ? 'tabs' : 'khata'))}
          />

          {/* Part B1: Recovered by Bharosa Card */}
          <RecoveredCard
            recovered={recoveredStats}
            currencySymbol={currencySymbol}
            lang={lang}
          />

          {/* Customer Phone Live View Toggle */}
          <button
            type="button"
            className={`judge-launcher-card ${judgeSplitOpen ? 'active' : ''}`}
            onClick={() => setJudgeSplitOpen((o) => !o)}
          >
            <div className="judge-launcher-left">
              <Smartphone size={20} />
              <div>
                <strong>
                  {lang === 'hi'
                    ? '📱 ग्राहक फ़ोन व्यू (WhatsApp + PayPal)'
                    : '📱 Customer Phone View (WhatsApp + PayPal)'}
                </strong>
                <span>
                  {lang === 'hi'
                    ? 'एक ही स्क्रीन पर ग्राहक चैट और PayPal पेमेंट दिखाएं'
                    : 'Side-by-side live two-way AI chat & PayPal checkout'}
                </span>
              </div>
            </div>
            <span className="judge-launcher-badge">
              {judgeSplitOpen
                ? lang === 'hi'
                  ? 'बंद करें'
                  : 'Hide'
                : lang === 'hi'
                  ? 'खोलें ▸'
                  : 'Open ▸'}
            </span>
          </button>

          {/* AI Vision Menu Card Scanner & Fake Screenshot Shield */}
          <button
            type="button"
            className="menu-scanner-launcher-card"
            onClick={() => {
              setScannerInitialMode('menu');
              setMenuScannerOpen(true);
            }}
          >
            <div className="judge-launcher-left">
              <Camera size={20} />
              <div>
                <strong>
                  {lang === 'hi'
                    ? '📸 मेन्यू स्कैनर और 🛡️ नकली स्क्रीनशॉट जांच'
                    : '📸 Menu Scanner & 🛡️ Fake Screenshot Shield'}
                </strong>
                <span>
                  {lang === 'hi'
                    ? 'मेन्यू से Voice AI सिखाएं या नकली पेमेंट स्क्रीनशॉट पकड़ें'
                    : 'Scan menu to train Voice AI or verify customer payment screenshots'}
                </span>
              </div>
            </div>
            <span className="scanner-launcher-badge">
              {lang === 'hi' ? 'खोलें ▸' : 'Open ▸'}
            </span>
          </button>

          {/* Desktop Quick Actions & Recent Activity Feed (Part A3) */}
          <div className="desktop-activity-panel">
            <div className="activity-panel-header">
              <span className="activity-panel-title">
                <Activity size={16} />{' '}
                {lang === 'hi' ? 'ताज़ा गतिविधि (Live Activity)' : 'Recent Activity'}
              </span>
              <button
                type="button"
                className="btn-close-day-inline"
                onClick={() => setCloseDayOpen(true)}
              >
                <CalendarCheck size={15} />{' '}
                {lang === 'hi' ? 'दिन का हिसाब' : 'Close Day'}
              </button>
            </div>

            {activityFeed.length === 0 ? (
              <p className="activity-empty">
                {lang === 'hi'
                  ? 'लाइव ऑर्डर और पेमेंट यहाँ दिखेंगे।'
                  : 'Live orders and payments will appear here.'}
              </p>
            ) : (
              <ul className="activity-feed-list">
                {activityFeed.map((item) => (
                  <li key={item.id} className={`activity-feed-item feed-${item.tone}`}>
                    <span className="feed-item-text">
                      {lang === 'hi' ? item.textHi : item.textEn}
                    </span>
                    <span className="feed-item-time">{item.time}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>

        {/* Left Column on Desktop: Orders / Khata + Assistant + Alerts */}
        <div className="workspace-main-col">
          {/* Stall Assistant Spoken Answer Card */}
          {assistantCard && (
            <section className="assistant-answer-card" role="status" aria-live="polite">
              <div className="assistant-card-header">
                <span className="assistant-badge">
                  <Bot size={16} />{' '}
                  {lang === 'hi' ? 'स्टॉल असिस्टेंट' : 'Stall Assistant'}
                </span>
                <button
                  type="button"
                  className="assistant-close"
                  onClick={() => setAssistantCard(null)}
                  aria-label="Close assistant card"
                >
                  <X size={18} />
                </button>
              </div>
              <div className="assistant-question">“{assistantCard.question}”</div>
              <div className="assistant-spoken">{assistantCard.spokenText}</div>
            </section>
          )}

          {/* Error Banner */}
          {errorBanner && (
            <div className="error-alert-bar" role="alert">
              <span>⚠️ {errorBanner}</span>
              <button
                type="button"
                onClick={() => setErrorBanner(null)}
                aria-label="Dismiss error"
              >
                <X size={18} />
              </button>
            </div>
          )}

          {/* Reconciler Prompt */}
          {reconcilePrompt && (
            <div className="reconcile-banner" role="region" aria-label="Reconcile payment">
              <div className="reconcile-text">
                🤔 {lang === 'hi' ? reconcilePrompt.questionHi : reconcilePrompt.questionEn}
              </div>
              <div className="reconcile-buttons">
                {reconcilePrompt.candidates.map((cand) => (
                  <button
                    key={cand._id}
                    type="button"
                    className="primary-card-btn btn-surface-open"
                    onClick={async () => {
                      await handleSimulatePay(cand._id);
                      setReconcilePrompt(null);
                    }}
                  >
                    {lang === 'hi' ? `ऑर्डर #${cand.number}` : `Order #${cand.number}`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* 4. Main Content: Skeleton Loaders, Tab List (unpaid first), or Khata View */}
          <main className="main-content">
            {isLoading ? (
              <div className="skeleton-stack" aria-busy="true" aria-label={t(lang, 'loadingTabs')}>
                <div className="skeleton-card" />
                <div className="skeleton-card" />
                <div className="skeleton-card" />
              </div>
            ) : loadError ? (
              <div className="state-box state-error">
                <span className="state-icon">⚠️</span>
                <p>{loadError}</p>
                <button
                  type="button"
                  className="primary-card-btn btn-surface-neutral"
                  onClick={fetchAllData}
                >
                  ↻ {t(lang, 'retry')}
                </button>
              </div>
            ) : activeView === 'tabs' ? (
              <div className="tabs-list">
                {sortedTabs.length === 0 ? (
                  <div className="state-box">
                    <span className="state-icon">🎙️</span>
                    <p>{t(lang, 'emptyTabs')}</p>
                    <button
                      type="button"
                      className="primary-card-btn btn-surface-paid"
                      onClick={() =>
                        openTapBuilderModal({
                          title: lang === 'hi' ? 'टैप से ऑर्डर बनाएं' : 'Add Order by Tap',
                        })
                      }
                    >
                      ➕ {t(lang, 'addByTap')}
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Compact Filter Bar to eliminate endless scrolling */}
                    <div className="orders-filter-bar" role="tablist" aria-label="Order filters">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={orderFilter === 'smart'}
                        className={`order-filter-pill ${orderFilter === 'smart' ? 'active' : ''}`}
                        onClick={() => setOrderFilter('smart')}
                      >
                        ⚡ {lang === 'hi' ? 'सक्रिय + हाल के' : 'Active & Recent'}
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={orderFilter === 'unpaid'}
                        className={`order-filter-pill ${orderFilter === 'unpaid' ? 'active' : ''} ${
                          unpaidTabs.length > 0 ? 'has-unpaid' : ''
                        }`}
                        onClick={() => setOrderFilter('unpaid')}
                      >
                        ⏳ {lang === 'hi' ? 'बाकी' : 'Unpaid'} ({unpaidTabs.length})
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={orderFilter === 'completed'}
                        className={`order-filter-pill ${orderFilter === 'completed' ? 'active' : ''}`}
                        onClick={() => setOrderFilter('completed')}
                      >
                        ✓ {lang === 'hi' ? 'पूरे हुए' : 'Completed'} ({completedTabs.length})
                      </button>
                    </div>

                    {/* 1. Active / Unpaid Orders (Full Action Cards) */}
                    {orderFilter !== 'completed' && (
                      <section className="orders-section">
                        {unpaidTabs.length > 0 ? (
                          <>
                            <div className="orders-section-header">
                              <span className="orders-section-title">
                                🔴 {lang === 'hi' ? 'भुगतान बाकी (एक्शन लें)' : 'Needs Action / Unpaid'}
                              </span>
                              <span className="orders-section-count">{unpaidTabs.length}</span>
                            </div>
                            <div className="active-tabs-stack">
                              {unpaidTabs.map((tab) => (
                                <TabCard
                                  key={tab._id}
                                  tab={tab}
                                  menu={vendor?.menu || []}
                                  currencySymbol={currencySymbol}
                                  alertSeconds={alertSeconds}
                                  lang={lang}
                                  onShowQr={(selected) => setActiveQrTab(selected)}
                                  onMarkCash={handleMarkCash}
                                  onCorrectOrder={(selected) =>
                                    openTapBuilderModal({
                                      title:
                                        lang === 'hi'
                                          ? `ऑर्डर #${selected.number} बदलें`
                                          : `Edit Order #${selected.number}`,
                                      items: selected.items,
                                      mode: selected.mode,
                                      editingTabId: selected._id,
                                    })
                                  }
                                  onCancelTab={handleCancelTab}
                                  onRemindKhata={handleRemindKhata}
                                  onRefundTab={handleRefundTab}
                                  onSimulatePay={handleSimulatePay}
                                  devMode={showDemoDrawer}
                                />
                              ))}
                            </div>
                          </>
                        ) : (
                          orderFilter === 'unpaid' && (
                            <div className="all-clear-inline-card">
                              <span>✅</span>
                              <div>
                                <strong>
                                  {lang === 'hi'
                                    ? 'कोई बाकी ऑर्डर नहीं — सब क्लियर!'
                                    : 'Zero unpaid orders — all clear!'}
                                </strong>
                                <p>
                                  {lang === 'hi'
                                    ? 'नया ऑर्डर बोलकर या टैप से जोड़ें।'
                                    : 'Tap Speak or Add by Tap to start a new order.'}
                                </p>
                              </div>
                            </div>
                          )
                        )}
                      </section>
                    )}

                    {/* 2. Completed Orders (Compact 2-Column Receipt Strips + Show More Toggle) */}
                    {orderFilter !== 'unpaid' && completedTabs.length > 0 && (
                      <section className="orders-section completed-orders-section">
                        <div className="orders-section-header">
                          <span className="orders-section-title">
                            ✓ {lang === 'hi' ? 'हाल के पूरे हुए ऑर्डर (टैप कर खोलें)' : 'Recent Completed (Tap to expand)'}
                          </span>
                          <span className="orders-section-count">{completedTabs.length}</span>
                        </div>

                        <div className="compact-tabs-grid">
                          {(showAllCompleted || orderFilter === 'completed'
                            ? completedTabs
                            : completedTabs.slice(0, 6)
                          ).map((tab) => (
                            <TabCard
                              key={tab._id}
                              tab={tab}
                              compact={true}
                              menu={vendor?.menu || []}
                              currencySymbol={currencySymbol}
                              alertSeconds={alertSeconds}
                              lang={lang}
                              onShowQr={(selected) => setActiveQrTab(selected)}
                              onMarkCash={handleMarkCash}
                              onCorrectOrder={(selected) =>
                                openTapBuilderModal({
                                  title:
                                    lang === 'hi'
                                      ? `ऑर्डर #${selected.number} बदलें`
                                      : `Edit Order #${selected.number}`,
                                  items: selected.items,
                                  mode: selected.mode,
                                  editingTabId: selected._id,
                                })
                              }
                              onCancelTab={handleCancelTab}
                              onRemindKhata={handleRemindKhata}
                              onRefundTab={handleRefundTab}
                              onSimulatePay={handleSimulatePay}
                              devMode={showDemoDrawer}
                            />
                          ))}
                        </div>

                        {orderFilter === 'smart' && completedTabs.length > 6 && (
                          <button
                            type="button"
                            className="show-more-orders-btn"
                            onClick={() => setShowAllCompleted((prev) => !prev)}
                          >
                            {showAllCompleted
                              ? lang === 'hi'
                                ? '▴ कम ऑर्डर दिखाएं (सिर्फ ताज़ा 6)'
                                : '▴ Show fewer orders (latest 6 only)'
                              : lang === 'hi'
                                ? `▾ पुराने ${completedTabs.length - 6} और ऑर्डर दिखाएं`
                                : `▾ Show ${completedTabs.length - 6} older completed orders`}
                          </button>
                        )}
                      </section>
                    )}
                  </>
                )}
              </div>
            ) : (
              <KhataView
                customers={customers}
                currencySymbol={currencySymbol}
                lang={lang}
                onRemindTab={handleRemindKhata}
                onToggleConsent={handleToggleConsent}
                onMarkCash={handleMarkCash}
                onCancelTab={handleCancelTab}
                onUpdateCreditLimit={handleUpdateCreditLimit}
                onRefresh={fetchAllData}
                lastReminderInfo={lastReminderInfo}
              />
            )}
          </main>
        </div>
      </div>

      {/* Live Customer Smartphone Simulator (Judge Split-Screen View) */}
      <JudgeSimulatorPanel
        isOpen={judgeSplitOpen}
        onClose={() => setJudgeSplitOpen(false)}
        customers={customers}
        unpaidTabs={unpaidTabs}
        currencySymbol={currencySymbol}
        lang={lang}
        onSimulatePay={handleSimulatePay}
        onRemindKhata={handleRemindKhata}
        onRefreshAll={fetchAllData}
      />

      {/* 5. Fixed Bottom Dock (Equal-size Add by Tap, Ask Stall, Khata around Centre Speak Mic) */}
      <MicButton
        lang={lang}
        menu={vendor?.menu || []}
        activeView={activeView}
        onSelectView={setActiveView}
        isProcessing={isProcessing}
        onStartVoiceOrder={handleStartVoiceOrder}
        onSimulateVoiceTranscript={handleVoiceTranscript}
        onAskAssistant={handleAskAssistant}
        showDemoDrawer={showDemoDrawer}
        onOpenTapModal={() =>
          openTapBuilderModal({
            title: lang === 'hi' ? 'टैप से ऑर्डर बनाएं' : 'Add Order by Tap',
          })
        }
      />

      {/* Part A2: Full-Screen Listening Overlay */}
      <ListeningOverlay
        isOpen={listeningOpen}
        lang={lang}
        menu={vendor?.menu || []}
        interimTranscript={interimTranscript}
        onSubmitTranscript={(txt) => {
          handleCancelVoiceOrder();
          handleVoiceTranscript(txt);
        }}
        onCancel={handleCancelVoiceOrder}
      />

      {/* Part A2, B3, B4: Confirmation Card after Voice Recognition */}
      {confirmationOrder && (
        <ConfirmationCard
          parsedOrder={confirmationOrder}
          customers={customers}
          currencySymbol={currencySymbol}
          lang={lang}
          isProcessing={isProcessing}
          onConfirm={(payload) => createTabFromParsed(payload)}
          onEdit={(payload) => {
            setConfirmationOrder(null);
            openTapBuilderModal({
              title: lang === 'hi' ? 'ऑर्डर बदलें' : 'Edit Order',
              transcript: confirmationOrder.transcript,
              items: payload.items,
              mode: payload.mode,
              customerId: payload.customerId,
              customerName: payload.customerName,
            });
          }}
          onCancel={() => setConfirmationOrder(null)}
        />
      )}

      {/* Part B2: Close-Day Summary Modal */}
      {closeDayOpen && (
        <CloseDayModal
          lang={lang}
          currencySymbol={currencySymbol}
          onClose={() => setCloseDayOpen(false)}
        />
      )}

      {/* AI Vision Menu Card & Fake Screenshot Shield Modal */}
      <MenuScannerModal
        isOpen={menuScannerOpen}
        onClose={() => setMenuScannerOpen(false)}
        vendor={vendor}
        currencySymbol={currencySymbol}
        lang={lang}
        initialMode={scannerInitialMode}
        onSpeak={(txt) => speakText(txt, lang)}
        onMenuSaved={(updatedVendor) => {
          setVendor(updatedVendor);
          addToast(
            lang === 'hi'
              ? `✓ मेन्यू अपडेट! Voice AI ने ${updatedVendor.menu?.length || 0} आइटम सीख लिए`
              : `✓ Menu locked! Voice AI trained on ${updatedVendor.menu?.length || 0} items`,
            'paid'
          );
          speakText(
            lang === 'hi'
              ? `${updatedVendor.name} का नया मेन्यू सेव हो गया। अब आप बोलकर ऑर्डर ले सकते हैं।`
              : `Menu updated for ${updatedVendor.name}. Voice AI is ready for orders.`,
            lang
          );
          fetchAllData();
        }}
        onCreateOrderFromSlip={(payload) => createTabFromParsed(payload)}
      />

      {/* 3-Step Vendor Registration & PayPal Onboarding Wizard */}
      <VendorOnboardingModal
        isOpen={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        vendor={vendor}
        lang={lang}
        onChangeLang={(nextLang) => setLang(nextLang)}
        currencySymbol={currencySymbol}
        onRegistered={(data) => {
          if (data?.vendor) {
            setVendor(data.vendor);
          }
          addToast(
            lang === 'hi'
              ? `🚀 ${data?.vendor?.name || 'स्टॉल'} रजिस्टर और PayPal से जुड़ गया!`
              : `🚀 ${data?.vendor?.name || 'Stall'} registered & linked to PayPal!`,
            'paid'
          );
          if (data?.spokenHi || data?.spokenEn) {
            speakText(lang === 'hi' ? data.spokenHi : data.spokenEn, lang);
          }
          fetchAllData();
        }}
      />

      {/* Part 2.4: Smart Alert Timing Modal */}
      {smartTimingModalOpen && (
        <SmartAlertTimingCard
          lang={lang}
          isModal={true}
          onClose={() => setSmartTimingModalOpen(false)}
          onTimingChanged={(rep) => {
            if (rep?.currentAlertSeconds) {
              setAlertSeconds(Number(rep.currentAlertSeconds));
            }
          }}
        />
      )}

      {/* 6. Large High-Contrast PayPal QR Modal */}
      {activeQrTab && (
        <QrView
          tab={activeQrTab}
          currencySymbol={currencySymbol}
          lang={lang}
          onClose={() => setActiveQrTab(null)}
          onMarkCash={handleMarkCash}
          onSimulatePay={handleSimulatePay}
          onEditTab={(selected) => {
            setActiveQrTab(null);
            openTapBuilderModal({
              title:
                lang === 'hi'
                  ? `ऑर्डर #${selected.number} बदलें`
                  : `Edit Order #${selected.number}`,
              items: selected.items,
              mode: selected.mode,
              editingTabId: selected._id,
            });
          }}
          devMode={true}
        />
      )}

      {/* 7. MenuTiles (Add by Tap / Edit fallback) */}
      {builderModal && (
        <MenuTiles
          builderModal={builderModal}
          setBuilderModal={setBuilderModal}
          customers={customers}
          currencySymbol={currencySymbol}
          lang={lang}
          isProcessing={isProcessing}
          onSubmit={handleSaveBuilderModal}
          onClose={() => setBuilderModal(null)}
        />
      )}

      {/* 8. Full-Screen Green PaymentSuccess Overlay + Chime */}
      <PaymentSuccess
        paidOverlay={paidOverlay}
        currencySymbol={currencySymbol}
        lang={lang}
        onDismiss={() => setPaidOverlay(null)}
      />
    </div>
  );
}
