import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Smartphone,
  Send,
  MessageCircle,
  CreditCard,
  X,
  Sparkles,
  CheckCircle2,
  ExternalLink,
  BellRing,
  PlusCircle,
} from 'lucide-react';
import { socket } from '../lib/socket.js';

const QUICK_REPLIES = [
  {
    label: '🤝 Promise Friday',
    text: 'Bhaiya Friday ko pakka de dunga',
  },
  {
    label: '💸 Partial ₹50 + Kal',
    text: 'Abhi 50 de raha hoon baaki kal subah',
  },
  {
    label: '❓ Ask Balance',
    text: 'Bhaiya mera total kitna baaki hai?',
  },
  {
    label: '⚠️ Dispute Order',
    text: 'Ye mera order nahi tha bhaiya',
  },
];

function extractUrlFromText(text = '') {
  const match = String(text).match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}

function stripRawUrl(text = '') {
  return String(text)
    .replace(/https?:\/\/[^\s]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export default function JudgeSimulatorPanel({
  isOpen,
  onClose,
  customers = [],
  unpaidTabs = [],
  currencySymbol = '₹',
  lang = 'hi',
  onSimulatePay,
  onRemindKhata,
  onRefreshAll,
}) {
  const [phoneTab, setPhoneTab] = useState('whatsapp'); // 'whatsapp' | 'paypal'
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [messages, setMessages] = useState([]);
  const [promises, setPromises] = useState([]);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [payingTabId, setPayingTabId] = useState(null);
  const chatBottomRef = useRef(null);

  // Deduplicate customers by name (preferring ones with balance or messages)
  const uniqueCustomers = useMemo(() => {
    const map = new Map();
    for (const c of customers) {
      const key = String(c.name || '').trim().toLowerCase();
      const existing = map.get(key);
      if (
        !existing ||
        (c.outstandingBalance || 0) > (existing.outstandingBalance || 0) ||
        (c.messages?.length || 0) > (existing.messages?.length || 0)
      ) {
        map.set(key, c);
      }
    }
    return Array.from(map.values());
  }, [customers]);

  // Pick first customer with outstandingBalance > 0 (or first customer) by default
  useEffect(() => {
    if (!selectedCustomerId && uniqueCustomers.length > 0) {
      const withDue =
        uniqueCustomers.find((c) => (c.outstandingBalance || 0) > 0) || uniqueCustomers[0];
      setSelectedCustomerId(withDue._id);
    }
  }, [uniqueCustomers, selectedCustomerId]);

  const selectedCustomer =
    uniqueCustomers.find((c) => c._id === selectedCustomerId) || uniqueCustomers[0] || null;

  // Keep messages synced with selectedCustomer.messages immediately + fetch latest from API
  useEffect(() => {
    if (selectedCustomer?.messages) {
      setMessages(selectedCustomer.messages);
    }
    if (selectedCustomer?.activePromise) {
      setPromises([selectedCustomer.activePromise]);
    } else {
      setPromises([]);
    }
  }, [selectedCustomer]);

  const fetchThread = useCallback(async () => {
    if (!selectedCustomer?._id) return;
    try {
      const res = await fetch(`/api/customers/${selectedCustomer._id}/messages`);
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.messages)) {
          setMessages(data.messages);
        }
        if (Array.isArray(data.promises)) {
          setPromises(data.promises);
        }
      }
    } catch {
      // fallback to customer prop messages
    }
  }, [selectedCustomer?._id]);

  useEffect(() => {
    if (isOpen && selectedCustomer?._id) {
      fetchThread();
    }
  }, [isOpen, selectedCustomer?._id, fetchThread]);

  // Auto-refresh thread when socket events arrive
  useEffect(() => {
    if (!isOpen) return undefined;
    const handleUpdate = () => {
      fetchThread();
      onRefreshAll?.();
    };
    socket.on('message:received', handleUpdate);
    socket.on('reminder:sent', handleUpdate);
    socket.on('promise:created', handleUpdate);
    socket.on('promise:updated', handleUpdate);
    socket.on('tab:paid', handleUpdate);
    return () => {
      socket.off('message:received', handleUpdate);
      socket.off('reminder:sent', handleUpdate);
      socket.off('promise:created', handleUpdate);
      socket.off('promise:updated', handleUpdate);
      socket.off('tab:paid', handleUpdate);
    };
  }, [isOpen, fetchThread, onRefreshAll]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  if (!isOpen) return null;

  const handleSendWhatsApp = async (textOverride) => {
    const textToSend = (textOverride ?? replyText).trim();
    if (!textToSend || !selectedCustomer?.phone || sending) return;
    setSending(true);
    if (!textOverride) setReplyText('');
    try {
      const res = await fetch('/api/dev/whatsapp-inbound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: selectedCustomer.phone,
          text: textToSend,
          ignoreQuietHours: true,
          ignoreRateLimits: true,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        // Optimistically append inbound & outbound messages immediately if returned
        if (data.inboundMessage) {
          setMessages((prev) => {
            const next = [...prev.filter((m) => m._id !== data.inboundMessage._id), data.inboundMessage];
            if (data.outboundResult?.messageDoc) {
              next.push(data.outboundResult.messageDoc);
            }
            return next;
          });
        }
        await fetchThread();
        onRefreshAll?.();
      }
    } finally {
      setSending(false);
    }
  };

  const handleCreateSampleKhataAndRemind = async () => {
    if (!selectedCustomer || sending) return;
    setSending(true);
    try {
      const createRes = await fetch('/api/tabs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: [
            { name: 'Chaat', emoji: '🍲', qty: 2, unitPrice: 40 },
            { name: 'Chai', emoji: '☕', qty: 1, unitPrice: 20 },
          ],
          amount: 100,
          mode: 'KHATA',
          customerId: selectedCustomer._id,
          customerName: selectedCustomer.name,
        }),
      });
      const createData = await createRes.json();
      if (createRes.ok && createData.tab?._id) {
        await onRemindKhata?.(createData.tab._id);
        await fetchThread();
        onRefreshAll?.();
      }
    } finally {
      setSending(false);
    }
  };

  const customerKhataTab = selectedCustomer?.openKhataTabs?.[0] || null;

  const handlePayTab = async (tabId, customAmount = undefined) => {
    setPayingTabId(tabId);
    try {
      await onSimulatePay?.(tabId, customAmount);
      await fetchThread();
      onRefreshAll?.();
    } finally {
      setTimeout(() => setPayingTabId(null), 500);
    }
  };

  return (
    <aside className="judge-simulator-dock" aria-label="Judge Live Customer Phone Simulator">
      <div className="judge-phone-frame">
        {/* Top Phone Speaker & Status Bar */}
        <div className="judge-phone-notch-bar">
          <div className="judge-phone-pill">
            <Smartphone size={14} />
            <span>
              {lang === 'hi'
                ? 'ग्राहक का फ़ोन (Customer Phone View)'
                : 'Customer Phone (Live View)'}
            </span>
          </div>
          <button
            type="button"
            className="judge-close-btn"
            onClick={onClose}
            aria-label="Close Customer Phone"
          >
            <X size={16} />
          </button>
        </div>

        {/* App Switcher inside Customer Phone: WhatsApp vs PayPal */}
        <div className="judge-app-switcher">
          <button
            type="button"
            className={`judge-app-tab ${phoneTab === 'whatsapp' ? 'active-wa' : ''}`}
            onClick={() => setPhoneTab('whatsapp')}
          >
            <MessageCircle size={16} />
            <span>WhatsApp AI Chat</span>
          </button>
          <button
            type="button"
            className={`judge-app-tab ${phoneTab === 'paypal' ? 'active-pp' : ''}`}
            onClick={() => setPhoneTab('paypal')}
          >
            <CreditCard size={16} />
            <span>PayPal Checkout ({unpaidTabs.length})</span>
          </button>
        </div>

        {phoneTab === 'whatsapp' ? (
          <div className="judge-wa-container">
            {/* Customer Selector Bar (Wrapped cleanly, no scrollbar!) */}
            <div className="judge-wa-header">
              <div className="judge-cust-pills-wrap">
                {uniqueCustomers.map((c) => (
                  <button
                    key={c._id}
                    type="button"
                    className={`judge-cust-chip ${
                      selectedCustomer?._id === c._id ? 'selected' : ''
                    }`}
                    onClick={() => setSelectedCustomerId(c._id)}
                  >
                    {c.name} ({currencySymbol}
                    {c.outstandingBalance || 0})
                  </button>
                ))}
              </div>

              {customerKhataTab ? (
                <button
                  type="button"
                  className="judge-trigger-remind-btn"
                  disabled={sending}
                  onClick={async () => {
                    await onRemindKhata?.(customerKhataTab._id);
                    setTimeout(fetchThread, 350);
                  }}
                >
                  <BellRing size={13} /> Send AI Reminder to {selectedCustomer?.name} (
                  {currencySymbol}
                  {selectedCustomer?.outstandingBalance})
                </button>
              ) : (
                <button
                  type="button"
                  className="judge-trigger-remind-btn"
                  disabled={sending}
                  onClick={handleCreateSampleKhataAndRemind}
                >
                  <PlusCircle size={13} /> Add {currencySymbol}100 Khata & Send AI Reminder to{' '}
                  {selectedCustomer?.name}
                </button>
              )}
            </div>

            {/* Active Promise Badge */}
            {promises.length > 0 && (
              <div className="judge-promise-strip">
                <Sparkles size={14} />
                <span>
                  AI Promise: <strong>{promises[0].status}</strong>
                  {promises[0].amount ? ` • ${currencySymbol}${promises[0].amount}` : ''}
                  {promises[0].dueDateStr ? ` • Due ${promises[0].dueDateStr}` : ''}
                </span>
              </div>
            )}

            {/* WhatsApp Chat Wallpaper & Bubbles */}
            <div className="judge-wa-messages">
              {messages.length === 0 ? (
                <div className="judge-wa-empty">
                  <p>
                    No messages yet for <strong>{selectedCustomer?.name}</strong>.
                  </p>
                  <p>
                    Click <strong>&ldquo;🤝 Promise Friday&rdquo;</strong> or{' '}
                    <strong>&ldquo;💸 Partial ₹50 + Kal&rdquo;</strong> below to watch the Two-Way
                    AI Collector reply in real time!
                  </p>
                </div>
              ) : (
                messages.map((m) => {
                  const linkUrl = extractUrlFromText(m.body);
                  const cleanText = stripRawUrl(m.body);

                  return (
                    <div
                      key={m._id}
                      className={`judge-wa-bubble ${
                        m.direction === 'IN' ? 'wa-bubble-customer' : 'wa-bubble-stall'
                      }`}
                    >
                      <div className="wa-bubble-sender">
                        {m.direction === 'IN' ? (
                          <span>👤 {selectedCustomer?.name}</span>
                        ) : (
                          <span>🤖 Bharosa AI</span>
                        )}
                        {m.intent && <span className="wa-intent-tag">{m.intent}</span>}
                      </div>
                      <div className="wa-bubble-text">{cleanText}</div>
                      {linkUrl && (
                        <a
                          href={linkUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="wa-inline-pay-btn"
                        >
                          <ExternalLink size={12} /> Pay via PayPal Link
                        </a>
                      )}
                    </div>
                  );
                })
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* 1-Tap Quick-Reply Chips for Demo (2x2 Grid — No Scrollbar!) */}
            <div className="judge-quick-chips-grid">
              {QUICK_REPLIES.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className="judge-quick-chip"
                  disabled={sending}
                  onClick={() => handleSendWhatsApp(item.text)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {/* Custom Message Input */}
            <form
              className="judge-wa-input-bar"
              onSubmit={(e) => {
                e.preventDefault();
                handleSendWhatsApp();
              }}
            >
              <input
                type="text"
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder={`Reply as ${selectedCustomer?.name || 'Customer'}...`}
                className="judge-wa-input"
                disabled={sending}
              />
              <button
                type="submit"
                className="judge-wa-send-btn"
                disabled={sending || !replyText.trim()}
              >
                <Send size={16} />
              </button>
            </form>
          </div>
        ) : (
          <div className="judge-pp-container">
            <div className="judge-pp-brand-banner">
              <strong>💙 PayPal Customer Checkout Simulator</strong>
              <span>Instant webhook confirmation → Vendor Stall Light turns GREEN</span>
            </div>

            {unpaidTabs.length === 0 ? (
              <div className="judge-wa-empty">
                <CheckCircle2 size={32} color="#1B8A3A" />
                <p>
                  <strong>All orders are paid!</strong>
                </p>
                <p>
                  Create a new order on the Vendor screen (via Speak or Add by Tap) and it will
                  appear here immediately for 1-click PayPal payment.
                </p>
              </div>
            ) : (
              <div className="judge-pp-orders-list">
                {unpaidTabs.map((tab) => {
                  const alreadyPaid = Number(tab.paypal?.paidAmount || 0);
                  const remainingAmt = Math.max(0, Number(tab.amount) - alreadyPaid);
                  const halfAmt = Math.max(1, Math.round(remainingAmt / 2));

                  return (
                    <div key={tab._id} className="judge-pp-card">
                      <div className="judge-pp-card-top">
                        <span className="judge-pp-order-num">Order #{tab.number}</span>
                        <span className="judge-pp-status">{tab.status}</span>
                      </div>
                      <div className="judge-pp-items">
                        {(tab.items || []).map((i) => `${i.qty}× ${i.name}`).join(', ')}
                      </div>
                      <div className="judge-pp-amount">
                        {currencySymbol}
                        {remainingAmt}
                        {alreadyPaid > 0 && (
                          <span className="judge-pp-partial-note">
                            {' '}
                            (Paid {currencySymbol}
                            {alreadyPaid} of {currencySymbol}
                            {tab.amount})
                          </span>
                        )}
                      </div>
                      <div className="judge-pp-actions">
                        <button
                          type="button"
                          className="judge-pp-pay-btn"
                          disabled={payingTabId === tab._id}
                          onClick={() => handlePayTab(tab._id, remainingAmt)}
                        >
                          {payingTabId === tab._id
                            ? 'Processing PayPal...'
                            : `⚡ Pay ${currencySymbol}${remainingAmt}`}
                        </button>
                        {remainingAmt >= 20 && tab.status !== 'PARTIAL' && (
                          <button
                            type="button"
                            className="judge-pp-split-btn"
                            disabled={payingTabId === tab._id}
                            onClick={() => handlePayTab(tab._id, halfAmt)}
                            title="Split bill among 2 friends (Pay half now)"
                          >
                            👥 Split ÷2 ({currencySymbol}
                            {halfAmt})
                          </button>
                        )}
                        <a
                          href={`/pay/${tab._id}`}
                          target="_blank"
                          rel="noreferrer"
                          className="judge-pp-link-btn"
                          title="Open full PayPal JS SDK checkout page"
                        >
                          <ExternalLink size={15} />
                        </a>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
