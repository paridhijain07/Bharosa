import React, { useState } from 'react';
import {
  Volume2,
  MessageCircle,
  Banknote,
  Sparkles,
  Check,
  Edit3,
  User,
  BookOpen,
  ExternalLink,
  AlertTriangle,
  CalendarClock,
  XCircle,
  Send,
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { speakText } from '../lib/speech.js';

/**
 * Cleanly replace raw long PayPal sandbox URLs in message text with a short readable label
 */
function formatCleanMessageText(text = '') {
  return String(text).replace(
    /https?:\/\/[^\s]+/g,
    '[🔗 PayPal One-Tap Link]'
  );
}

const DEMO_INBOUND_REPLIES = [
  {
    labelHi: '📅 "Friday ko de dunga"',
    labelEn: '📅 "Friday ko de dunga" (Promise)',
    text: 'Friday ko de dunga',
  },
  {
    labelHi: '💵 "abhi 100 de raha hoon baaki kal"',
    labelEn: '💵 "abhi 100 de raha hoon baaki kal" (Partial)',
    text: 'abhi 100 de raha hoon baaki kal',
  },
  {
    labelHi: '⚠️ "mera nahi tha ye order"',
    labelEn: '⚠️ "mera nahi tha ye order" (Dispute)',
    text: 'mera nahi tha ye order',
  },
  {
    labelHi: '🛑 "band karo"',
    labelEn: '🛑 "band karo" (Opt-out)',
    text: 'band karo',
  },
];

function formatShortPromiseChip(activePromise, lang = 'hi') {
  if (!activePromise) return null;
  const rawDate = activePromise.dueDateStr || activePromise.dueDate;
  if (!rawDate) return null;
  const dt = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(String(rawDate)) ? `${rawDate}T12:00:00` : rawDate
  );
  const formatted = dt.toLocaleDateString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  if (activePromise.status === 'BROKEN') {
    return {
      tone: 'alert',
      label: lang === 'hi' ? `वादा बीत गया (${formatted})` : `Overdue (${formatted})`,
    };
  }
  return {
    tone: 'promised',
    label: lang === 'hi' ? `वादा: ${formatted}` : `Promised ${formatted}`,
  };
}

function getCustomerCollectorChip(customer, lang = 'hi') {
  const status = customer.collectorStatus || 'NONE';
  if (status === 'DISPUTED' || (customer.openKhataTabs || []).some((t) => t.disputed)) {
    return {
      tone: 'alert',
      label: lang === 'hi' ? '⚠️ विवादित (Disputed)' : '⚠️ Disputed',
    };
  }
  if (status === 'NEEDS_VENDOR') {
    return {
      tone: 'open',
      label: lang === 'hi' ? '👋 ध्यान दें (Needs you)' : '👋 Needs you',
    };
  }
  if (status === 'OPTED_OUT' || !customer.whatsappConsent) {
    return {
      tone: 'neutral',
      label: lang === 'hi' ? '🔕 ऑप्ट-आउट (Opted out)' : '🔕 Opted out',
    };
  }
  if (customer.activePromise) {
    return formatShortPromiseChip(customer.activePromise, lang);
  }
  if (status === 'PROMISED') {
    return {
      tone: 'promised',
      label: customer.collectorNote || (lang === 'hi' ? 'वादा किया' : 'Promised'),
    };
  }
  return null;
}

export default function KhataView({
  customers = [],
  currencySymbol = '₹',
  lang = 'hi',
  onRemindTab,
  onToggleConsent,
  onMarkCash,
  onCancelTab,
  onUpdateCreditLimit,
  onRefresh,
  lastReminderInfo,
}) {
  const [remindingId, setRemindingId] = useState(null);
  const [editingLimitId, setEditingLimitId] = useState(null);
  const [limitInput, setLimitInput] = useState('');
  const [savingLimitId, setSavingLimitId] = useState(null);
  const [simulatingId, setSimulatingId] = useState(null);
  const [actionBusyId, setActionBusyId] = useState(null);
  const [expandedChatIds, setExpandedChatIds] = useState({});
  const [dismissedReminderKey, setDismissedReminderKey] = useState(null);

  const toggleChatThread = (customerId) => {
    setExpandedChatIds((prev) => ({
      ...prev,
      [customerId]: !prev[customerId],
    }));
  };

  const handleRemindCustomer = async (customer) => {
    const firstOpenTab = (customer.openKhataTabs || [])[0];
    if (!firstOpenTab) return;
    setRemindingId(customer._id);
    try {
      await onRemindTab(firstOpenTab._id);
    } finally {
      setRemindingId(null);
    }
  };

  const handleSimulateInbound = async (customer, replyText) => {
    setSimulatingId(`${customer._id}-${replyText}`);
    try {
      const res = await fetch('/api/dev/whatsapp-inbound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: customer.phone,
          text: replyText,
        }),
      });
      if (res.ok) {
        onRefresh?.();
      }
    } finally {
      setSimulatingId(null);
    }
  };

  const handleTemplateReply = async (customer) => {
    setActionBusyId(customer._id);
    try {
      const res = await fetch(`/api/khata/customer/${customer._id}/template-reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: lang }),
      });
      if (res.ok) {
        onRefresh?.();
      }
    } finally {
      setActionBusyId(null);
    }
  };

  const handleAcceptSuggestion = async (customer, suggestedLimit) => {
    if (!onUpdateCreditLimit) return;
    setSavingLimitId(customer._id);
    try {
      await onUpdateCreditLimit(customer._id, suggestedLimit);
    } finally {
      setSavingLimitId(null);
      setEditingLimitId(null);
    }
  };

  const handleSaveCustomLimit = async (customerId) => {
    const num = Number(limitInput);
    if (!Number.isFinite(num) || num < 0 || !onUpdateCreditLimit) return;
    setSavingLimitId(customerId);
    try {
      await onUpdateCreditLimit(customerId, Math.round(num));
    } finally {
      setSavingLimitId(null);
      setEditingLimitId(null);
    }
  };

  const handleSpeakSummary = (customer) => {
    const count = customer.reminderCount || 0;
    const text =
      lang === 'hi'
        ? `${customer.name} के ${customer.outstandingBalance} रुपये बाकी हैं, ${count} बार याद दिलाया गया।`
        : `${customer.name} owes ${customer.outstandingBalance} rupees, reminded ${
            count === 1 ? 'once' : count === 2 ? 'twice' : count + ' times'
          }, no reply.`;
    speakText(text, lang, [100]);
  };

  const handleSpeakAllKhata = () => {
    const owing = customers.filter((c) => c.outstandingBalance > 0);
    if (owing.length === 0) {
      speakText(
        lang === 'hi' ? 'कोई खाता बाकी नहीं है।' : 'No pending khata balance.',
        lang
      );
      return;
    }
    const sentences = owing.map((c) => {
      const count = c.reminderCount || 0;
      return lang === 'hi'
        ? `${c.name} के ${c.outstandingBalance} रुपये बाकी हैं, ${count} बार याद दिलाया गया।`
        : `${c.name} owes ${c.outstandingBalance} rupees, reminded ${
            count === 1 ? 'once' : count === 2 ? 'twice' : count + ' times'
          }.`;
    });
    speakText(sentences.join(' '), lang);
  };

  // Part 1.7: "Needs you" list at the top of KhataView for NEEDS_VENDOR and DISPUTE items
  const needsYouCustomers = customers.filter(
    (c) =>
      c.collectorStatus === 'NEEDS_VENDOR' ||
      c.collectorStatus === 'DISPUTED' ||
      (c.openKhataTabs || []).some((t) => t.disputed)
  );

  // Sort customers: unpaid balance > 0 first, then needs attention, then settled ₹0
  const sortedCustomers = [...customers].sort((a, b) => {
    const aDue = Number(a.outstandingBalance) || 0;
    const bDue = Number(b.outstandingBalance) || 0;
    if (aDue > 0 && bDue === 0) return -1;
    if (aDue === 0 && bDue > 0) return 1;
    if (bDue !== aDue) return bDue - aDue;
    return (b.messages?.length || 0) - (a.messages?.length || 0);
  });

  const reminderKey = lastReminderInfo?.reminder?.message || '';
  const showReminderBanner =
    Boolean(lastReminderInfo) && dismissedReminderKey !== reminderKey;

  return (
    <section className="khata-section" aria-label="Khata credit register">
      <div className="khata-header-bar">
        <h2 className="khata-section-title">
          <BookOpen size={22} aria-hidden="true" />{' '}
          {lang === 'hi' ? 'उधार / खाता रजिस्टर' : 'Khata Credit Register'}
        </h2>
        <button
          type="button"
          className="btn-khata-summary-pill"
          onClick={handleSpeakAllKhata}
        >
          <Volume2 size={18} aria-hidden="true" />{' '}
          {lang === 'hi' ? 'पूरा हिसाब सुनें' : 'Hear Summary'}
        </button>
      </div>

      {/* Part 1.7: "Needs you" list at the top of KhataView (NEEDS_VENDOR & DISPUTE) */}
      {needsYouCustomers.length > 0 && (
        <div className="needs-you-panel" role="region" aria-label="Customers needing attention">
          <div className="needs-you-header">
            <AlertTriangle size={20} />
            <span>
              {lang === 'hi'
                ? `आपका ध्यान चाहिए (${needsYouCustomers.length})`
                : `Needs You (${needsYouCustomers.length})`}
            </span>
          </div>

          <div className="needs-you-list">
            {needsYouCustomers.map((cust) => {
              const firstTab = (cust.openKhataTabs || [])[0];
              const latestInbound = [...(cust.messages || [])]
                .reverse()
                .find((m) => m.direction === 'IN');

              return (
                <div key={cust._id} className="needs-you-card">
                  <div className="needs-you-top">
                    <strong>
                      {cust.name} ({currencySymbol}
                      {cust.outstandingBalance})
                    </strong>
                    <span className="needs-you-tag">
                      {cust.collectorStatus === 'DISPUTED'
                        ? lang === 'hi'
                          ? 'विवाद (Disputed)'
                          : 'Disputed'
                        : lang === 'hi'
                          ? 'जवाब देखें'
                          : 'Needs you'}
                    </span>
                  </div>

                  {latestInbound && (
                    <div className="needs-you-quote">“{latestInbound.body}”</div>
                  )}

                  <div className="needs-you-actions">
                    {firstTab && (
                      <button
                        type="button"
                        className="primary-card-btn btn-surface-cash"
                        onClick={() => onMarkCash?.(firstTab._id)}
                      >
                        <Banknote size={17} />{' '}
                        {lang === 'hi' ? 'कैश मिला' : 'Mark Paid in Cash'}
                      </button>
                    )}

                    {firstTab && onCancelTab && (
                      <button
                        type="button"
                        className="primary-card-btn btn-surface-neutral"
                        onClick={() => onCancelTab(firstTab._id, firstTab)}
                      >
                        <X size={17} />{' '}
                        {lang === 'hi' ? 'ऑर्डर रद्द करें' : 'Cancel Tab'}
                      </button>
                    )}

                    <button
                      type="button"
                      className="primary-card-btn btn-surface-khata"
                      disabled={actionBusyId === cust._id}
                      onClick={() => handleTemplateReply(cust)}
                    >
                      <Send size={17} />{' '}
                      {lang === 'hi'
                        ? 'टेम्पलेट जवाब भेजें'
                        : 'Send Template Reply'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showReminderBanner && (
        <div className="reminder-toast" role="status">
          <div className="reminder-toast-top">
            <div className="reminder-toast-title">
              ✓ {lang === 'hi' ? 'WhatsApp रिमाइंडर भेजा गया' : 'WhatsApp Reminder Sent'} (
              {lastReminderInfo.reminder?.tone})
            </div>
            <button
              type="button"
              className="reminder-toast-close"
              onClick={() => setDismissedReminderKey(reminderKey)}
              aria-label="Dismiss reminder banner"
            >
              <X size={16} />
            </button>
          </div>
          <div className="reminder-toast-msg">
            {formatCleanMessageText(lastReminderInfo.reminder?.message)}
          </div>
          {lastReminderInfo.payLink && (
            <a
              href={lastReminderInfo.payLink}
              target="_blank"
              rel="noreferrer"
              className="reminder-paylink"
            >
              <ExternalLink size={15} />{' '}
              {lang === 'hi' ? 'ग्राहक का PayPal लिंक खोलें' : 'Open Customer PayPal Link'}
            </a>
          )}
        </div>
      )}

      {sortedCustomers.length === 0 ? (
        <div className="state-box">
          <span className="state-icon">📓</span>
          <p>{lang === 'hi' ? 'कोई नियमित ग्राहक नहीं मिला।' : 'No regular customers found.'}</p>
        </div>
      ) : (
        <div className="khata-grid">
          {sortedCustomers.map((customer) => {
            const hasBalance = customer.outstandingBalance > 0;
            const lastRem = customer.lastReminder;
            const suggestion = customer.creditSuggestion;
            const activeLimit = customer.creditLimit;
            const isOverLimit =
              activeLimit != null && customer.outstandingBalance > activeLimit;
            const collectorChip = getCustomerCollectorChip(customer, lang);
            const messages = customer.messages || [];
            const firstOpenTab = (customer.openKhataTabs || [])[0];
            const firstTabPayLink = firstOpenTab?.paypal?.approvalUrl;
            const isChatExpanded = Boolean(expandedChatIds[customer._id]);
            const latestMsg = messages.length > 0 ? messages[messages.length - 1] : null;

            return (
              <article
                key={customer._id}
                className={`khata-card ${hasBalance ? 'khata-owing' : 'khata-settled'}`}
              >
                <div className="khata-card-header">
                  <div>
                    <div className="khata-cust-row">
                      <span className="khata-cust-name">
                        <User size={18} aria-hidden="true" /> {customer.name}
                      </span>
                      {/* Part 1.7: Collector Status Chip */}
                      {collectorChip && (
                        <span
                          className={`khata-collector-chip chip-tone-${collectorChip.tone}`}
                        >
                          {collectorChip.tone === 'promised' && (
                            <CalendarClock size={14} aria-hidden="true" />
                          )}
                          {collectorChip.tone === 'neutral' && (
                            <XCircle size={14} aria-hidden="true" />
                          )}
                          {collectorChip.label}
                        </span>
                      )}
                    </div>
                    <div className="khata-cust-phone">{customer.phone}</div>
                  </div>
                  <div className="khata-balance-col">
                    <div className="khata-balance">
                      {currencySymbol}
                      {customer.outstandingBalance}
                    </div>
                    {activeLimit != null && (
                      <span
                        className={`khata-limit-pill ${
                          isOverLimit ? 'limit-pill-over' : ''
                        }`}
                      >
                        {lang === 'hi'
                          ? `लिमिट: ${currencySymbol}${activeLimit}`
                          : `Limit: ${currencySymbol}${activeLimit}`}
                      </span>
                    )}
                  </div>
                </div>

                {/* Part B4: Smart Credit Limit Suggestion Banner */}
                {suggestion && (
                  <div className="smart-credit-box">
                    <div className="smart-credit-top">
                      <span className="smart-credit-title">
                        <Sparkles size={15} aria-hidden="true" />{' '}
                        {lang === 'hi' ? suggestion.friendlyHi : suggestion.friendlyEn}
                      </span>
                      {suggestion.isDemoData && (
                        <span className="demo-data-badge demo-badge-inline">
                          {lang === 'hi' ? 'डेमो डेटा' : 'Demo data'}
                        </span>
                      )}
                    </div>

                    {editingLimitId === customer._id ? (
                      <div className="smart-credit-edit-row">
                        <input
                          type="number"
                          min="0"
                          step="50"
                          className="credit-limit-input"
                          value={limitInput}
                          onChange={(e) => setLimitInput(e.target.value)}
                          aria-label="Custom credit limit"
                        />
                        <button
                          type="button"
                          className="btn-credit-small btn-credit-accept"
                          disabled={savingLimitId === customer._id}
                          onClick={() => handleSaveCustomLimit(customer._id)}
                        >
                          <Check size={15} /> {lang === 'hi' ? 'सेव' : 'Save'}
                        </button>
                        <button
                          type="button"
                          className="btn-credit-small"
                          onClick={() => setEditingLimitId(null)}
                        >
                          {lang === 'hi' ? 'रद्द' : 'Cancel'}
                        </button>
                      </div>
                    ) : (
                      <div className="smart-credit-actions">
                        {activeLimit !== suggestion.suggestedLimit && (
                          <button
                            type="button"
                            className="btn-credit-small btn-credit-accept"
                            disabled={savingLimitId === customer._id}
                            onClick={() =>
                              handleAcceptSuggestion(customer, suggestion.suggestedLimit)
                            }
                          >
                            <Check size={15} />{' '}
                            {lang === 'hi'
                              ? `स्वीकार करें (${currencySymbol}${suggestion.suggestedLimit})`
                              : `Accept (${currencySymbol}${suggestion.suggestedLimit})`}
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn-credit-small"
                          onClick={() => {
                            setEditingLimitId(customer._id);
                            setLimitInput(
                              String(
                                activeLimit != null
                                  ? activeLimit
                                  : suggestion.suggestedLimit
                              )
                            );
                          }}
                        >
                          <Edit3 size={14} />{' '}
                          {lang === 'hi' ? 'लिमिट बदलें' : 'Edit limit'}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* Part 1.7: Two-Way WhatsApp Conversation Thread (collapsible so cards stay compact) */}
                {messages.length > 0 && (
                  <div
                    className="khata-thread-box"
                    aria-label={`${customer.name} WhatsApp thread`}
                  >
                    <button
                      type="button"
                      className="khata-thread-toggle-bar"
                      onClick={() => toggleChatThread(customer._id)}
                      aria-expanded={isChatExpanded}
                    >
                      <div className="khata-thread-toggle-left">
                        <span className="khata-thread-title">
                          💬 {lang === 'hi' ? 'WhatsApp बातचीत' : 'WhatsApp Chat'} ({messages.length})
                        </span>
                        {!isChatExpanded && latestMsg && (
                          <span className="khata-thread-preview">
                            {latestMsg.direction === 'IN' ? `${customer.name}: ` : 'AI: '}
                            {formatCleanMessageText(latestMsg.body)}
                          </span>
                        )}
                      </div>
                      <span className="khata-thread-chevron">
                        {isChatExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      </span>
                    </button>

                    {isChatExpanded && (
                      <>
                        <div className="khata-thread-messages">
                          {messages.map((m) => (
                            <div
                              key={m._id}
                              className={`thread-bubble ${
                                m.direction === 'IN' ? 'bubble-inbound' : 'bubble-outbound'
                              }`}
                            >
                              <div className="bubble-meta">
                                <span>
                                  {m.direction === 'IN'
                                    ? `👤 ${customer.name}`
                                    : '🤖 Bharosa AI'}
                                </span>
                                {m.intent && (
                                  <span className="bubble-intent-tag">{m.intent}</span>
                                )}
                                <span>
                                  {new Date(m.createdAt).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </span>
                              </div>
                              <div className="bubble-text">{formatCleanMessageText(m.body)}</div>
                            </div>
                          ))}
                        </div>

                        {firstTabPayLink && firstOpenTab && (
                          <div className="khata-paylink-strip">
                            <a
                              href={`/pay/${firstOpenTab._id}`}
                              target="_blank"
                              rel="noreferrer"
                              className="reminder-paylink"
                            >
                              <ExternalLink size={14} />{' '}
                              {lang === 'hi'
                                ? `ग्राहक पेमेंट पेज खोलें (/pay/${firstOpenTab._id.slice(-4)})`
                                : 'Open Customer Payment Page (/pay)'}
                            </a>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Demo Customer Reply Simulator (for live demo without needing 2nd phone) */}
                {hasBalance && (
                  <div className="khata-demo-reply-bar">
                    <span className="demo-reply-label">
                      🧪{' '}
                      {lang === 'hi'
                        ? `${customer.name} का WhatsApp जवाब टेस्ट करें:`
                        : `Simulate ${customer.name}'s WhatsApp reply:`}
                    </span>
                    <div className="demo-reply-chips">
                      {DEMO_INBOUND_REPLIES.map((rep, idx) => {
                        const busyKey = `${customer._id}-${rep.text}`;
                        return (
                          <button
                            key={idx}
                            type="button"
                            className="btn-demo-reply-chip"
                            disabled={simulatingId === busyKey}
                            onClick={() => handleSimulateInbound(customer, rep.text)}
                          >
                            {lang === 'hi' ? rep.labelHi : rep.labelEn}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="khata-meta">
                  <label className="consent-toggle">
                    <input
                      type="checkbox"
                      checked={Boolean(customer.whatsappConsent)}
                      onChange={(e) => onToggleConsent(customer._id, e.target.checked)}
                    />
                    <span>
                      {lang === 'hi' ? 'WhatsApp सहमति' : 'WhatsApp Consent'}
                    </span>
                  </label>

                  <span className="reminded-count">
                    {lang === 'hi'
                      ? `याद दिलाया: ${customer.reminderCount || 0} बार`
                      : `Reminded: ${customer.reminderCount || 0}x`}
                  </span>
                </div>

                {lastRem && (
                  <div
                    className={`last-reminder-status status-${lastRem.status.toLowerCase()}`}
                  >
                    {lastRem.status === 'FAILED'
                      ? `⚠️ Failed: ${lastRem.error || 'Delivery error'}`
                      : `${lang === 'hi' ? 'अंतिम संदेश' : 'Last sent'} (${
                          lastRem.tone
                        }): ${new Date(lastRem.sentAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}`}
                  </div>
                )}

                <div className="khata-card-actions">
                  <button
                    type="button"
                    className="primary-card-btn btn-surface-khata"
                    disabled={
                      !hasBalance ||
                      !customer.whatsappConsent ||
                      customer.collectorStatus === 'DISPUTED' ||
                      remindingId === customer._id
                    }
                    onClick={() => handleRemindCustomer(customer)}
                  >
                    <MessageCircle size={18} aria-hidden="true" />{' '}
                    {remindingId === customer._id
                      ? lang === 'hi'
                        ? 'भेज रहे हैं…'
                        : 'Sending…'
                      : lang === 'hi'
                        ? 'याद दिलाएं (Remind)'
                        : 'Remind Now'}
                  </button>

                  <button
                    type="button"
                    className="primary-card-btn btn-surface-neutral"
                    onClick={() => handleSpeakSummary(customer)}
                  >
                    <Volume2 size={18} aria-hidden="true" />{' '}
                    {lang === 'hi' ? 'सुनें' : 'Speak'}
                  </button>

                  {hasBalance && firstOpenTab && (
                    <button
                      type="button"
                      className="primary-card-btn btn-surface-cash"
                      onClick={() => onMarkCash(firstOpenTab._id)}
                    >
                      <Banknote size={18} aria-hidden="true" />{' '}
                      {lang === 'hi' ? 'कैश' : 'Cash'}
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
