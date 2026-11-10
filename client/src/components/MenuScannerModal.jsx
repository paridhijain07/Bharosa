import React, { useState, useEffect } from 'react';
import {
  Camera,
  Sparkles,
  Check,
  Plus,
  Trash2,
  X,
  Upload,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
} from 'lucide-react';

export default function MenuScannerModal({
  isOpen,
  onClose,
  vendor,
  currencySymbol = '₹',
  lang = 'hi',
  onMenuSaved,
  initialMode = 'menu',
  onSpeak,
}) {
  const [activeMode, setActiveMode] = useState(initialMode || 'menu');
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [stallName, setStallName] = useState(vendor?.name || 'Sharma Ji Chaat & Chai Stall');
  const [items, setItems] = useState(vendor?.menu || []);
  const [selectedPreset, setSelectedPreset] = useState('chaat');
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');

  // Anti-Fraud Payment Screenshot Shield state
  const [verifyingReceipt, setVerifyingReceipt] = useState(false);
  const [selectedFraudPreset, setSelectedFraudPreset] = useState('');
  const [fraudResult, setFraudResult] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setActiveMode(initialMode || 'menu');
    }
  }, [isOpen, initialMode]);

  useEffect(() => {
    if (isOpen && vendor) {
      setStallName(vendor.name || 'Sharma Ji Chaat & Chai Stall');
      setItems(vendor.menu || []);
      const lowerName = (vendor.name || '').toLowerCase();
      if (lowerName.includes('cafeteria') || lowerName.includes('coffee')) {
        setSelectedPreset('cafeteria');
      } else if (lowerName.includes('juice') || lowerName.includes('shake')) {
        setSelectedPreset('juice');
      } else {
        setSelectedPreset('chaat');
      }
    }
  }, [isOpen, vendor]);

  if (!isOpen) return null;

  const handleVerifyReceipt = async (presetType, imageBase64 = null) => {
    setSelectedFraudPreset(presetType || 'upload');
    setVerifyingReceipt(true);
    try {
      const res = await fetch('/api/vendor/verify-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetType, imageBase64 }),
      });
      const data = await res.json();
      setTimeout(() => {
        setFraudResult(data);
        setVerifyingReceipt(false);
        if (onSpeak && (data.spokenHi || data.spokenEn)) {
          onSpeak(lang === 'hi' ? data.spokenHi : data.spokenEn);
        }
      }, 400);
    } catch {
      setVerifyingReceipt(false);
    }
  };

  const handleReceiptImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      handleVerifyReceipt(null, reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleScanPreset = async (presetKey) => {
    setSelectedPreset(presetKey);
    setScanning(true);
    try {
      const res = await fetch('/api/vendor/scan-menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetKey }),
      });
      const data = await res.json();
      if (res.ok && data.items) {
        setTimeout(() => {
          setStallName(data.stallName);
          setItems(data.items);
          setScanning(false);
        }, 450);
      } else {
        setScanning(false);
      }
    } catch {
      setScanning(false);
    }
  };

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanning(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await fetch('/api/vendor/scan-menu', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: reader.result }),
        });
        const data = await res.json();
        if (res.ok && data.items) {
          setTimeout(() => {
            setStallName(data.stallName);
            setItems(data.items);
            setScanning(false);
          }, 500);
        } else {
          setScanning(false);
        }
      } catch {
        setScanning(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleUpdateItemPrice = (idx, newPrice) => {
    setItems((prev) =>
      prev.map((item, i) => (i === idx ? { ...item, price: Number(newPrice) || 0 } : item))
    );
  };

  const handleDeleteItem = (idx) => {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleAddItem = (e) => {
    e.preventDefault();
    if (!newItemName.trim() || !newItemPrice) return;
    setItems((prev) => [
      ...prev,
      {
        name: newItemName.trim(),
        emoji: '🍽️',
        price: Math.max(1, Number(newItemPrice) || 20),
        aliases: [newItemName.trim().toLowerCase()],
      },
    ]);
    setNewItemName('');
    setNewItemPrice('');
  };

  const handleSaveMenu = async () => {
    if (items.length === 0 || saving) return;
    setSaving(true);
    try {
      const res = await fetch('/api/vendor/menu', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stallName, items }),
      });
      const data = await res.json();
      if (res.ok) {
        onMenuSaved?.(data.vendor);
        onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-backdrop scanner-backdrop-centered"
      role="dialog"
      aria-modal="true"
      aria-label="Scan Menu Card"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="menu-scanner-card">
        {/* Clean White Modal Header */}
        <div className="scanner-card-header">
          <div>
            <span className="scanner-step-pill">
              <Camera size={14} /> AI Vision & Payment Security
            </span>
            <h2 className="scanner-main-title">
              {activeMode === 'fraud'
                ? lang === 'hi'
                  ? '🛡️ नकली पेमेंट स्क्रीनशॉट जांच (AI Shield)'
                  : '🛡️ Anti-Fraud Payment Screenshot Shield'
                : lang === 'hi'
                  ? '📸 मेन्यू कार्ड स्कैन / सेट करें'
                  : '📸 Scan or Switch Stall Menu'}
            </h2>
            <p className="scanner-sub-text">
              {activeMode === 'fraud'
                ? lang === 'hi'
                  ? 'ग्राहक का पेमेंट स्क्रीनशॉट असली PayPal वेबहुक लेजर से क्रॉस-चेक करें और नकली/पुराने स्क्रीनशॉट तुरंत पकड़ें।'
                  : 'Cross-check customer payment screenshots against your live PayPal Webhook Ledger & AI Vision forensics.'
                : lang === 'hi'
                  ? 'मेन्यू फोटो स्कैन करें या चुनें — AI तुरंत ये आइटम और रेट सीख लेगा।'
                  : 'Pick a sample menu card or upload a photo — Voice AI will immediately understand these items and fixed prices.'}
            </p>
          </div>

          <button
            type="button"
            className="scanner-close-x"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={22} />
          </button>
        </div>

        {/* Mode Switcher Tabs: Menu Scanner vs Fake Screenshot Shield */}
        <div className="scanner-mode-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeMode === 'menu'}
            className={`scanner-mode-tab ${activeMode === 'menu' ? 'active' : ''}`}
            onClick={() => setActiveMode('menu')}
          >
            📋 {lang === 'hi' ? '1. मेन्यू कार्ड स्कैनर' : '1. Menu Card Scanner'}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeMode === 'fraud'}
            className={`scanner-mode-tab fraud-tab ${activeMode === 'fraud' ? 'active' : ''}`}
            onClick={() => {
              setActiveMode('fraud');
              if (!fraudResult) {
                handleVerifyReceipt('spoofed');
              }
            }}
          >
            🛡️ {lang === 'hi' ? '2. नकली स्क्रीनशॉट जांच (Fraud Shield)' : '2. Fake Screenshot Shield'}
          </button>
        </div>

        {activeMode === 'fraud' ? (
          <div className="fraud-shield-panel">
            <div className="scanner-step-label">
              {lang === 'hi'
                ? '1. ग्राहक द्वारा दिखाया गया स्क्रीनशॉट चुनें (या अपलोड करें):'
                : '1. Test a Customer Payment Screenshot Scenario (or Upload):'}
            </div>

            <div className="scanner-preset-grid">
              <button
                type="button"
                className={`scanner-preset-box fraud-preset-danger ${
                  selectedFraudPreset === 'spoofed' ? 'active' : ''
                }`}
                onClick={() => handleVerifyReceipt('spoofed')}
              >
                <span className="preset-box-emoji">🚨</span>
                <div>
                  <strong>
                    {lang === 'hi' ? 'नकली ₹100 स्क्रीनशॉट' : 'Spoofed ₹100 Screenshot'}
                  </strong>
                  <small>
                    {lang === 'hi'
                      ? 'एडिट किया हुआ नकली Txn ID'
                      : 'Photoshopped amount • Missing webhook'}
                  </small>
                </div>
              </button>

              <button
                type="button"
                className={`scanner-preset-box fraud-preset-warn ${
                  selectedFraudPreset === 'replay' ? 'active' : ''
                }`}
                onClick={() => handleVerifyReceipt('replay')}
              >
                <span className="preset-box-emoji">⚠️</span>
                <div>
                  <strong>
                    {lang === 'hi' ? '3 दिन पुराना स्क्रीनशॉट' : 'Old Screenshot (Replay)'}
                  </strong>
                  <small>
                    {lang === 'hi'
                      ? 'पुरानी रसीद दोबारा दिखाना'
                      : 'Reused receipt from 72 hours ago'}
                  </small>
                </div>
              </button>

              <button
                type="button"
                className={`scanner-preset-box fraud-preset-safe ${
                  selectedFraudPreset === 'genuine' ? 'active' : ''
                }`}
                onClick={() => handleVerifyReceipt('genuine')}
              >
                <span className="preset-box-emoji">✅</span>
                <div>
                  <strong>
                    {lang === 'hi' ? 'असली PayPal रसीद' : 'Genuine PayPal Receipt'}
                  </strong>
                  <small>
                    {lang === 'hi'
                      ? 'वेरिफाइड वेबहुक सिग्नेचर'
                      : 'Cryptographic webhook match'}
                  </small>
                </div>
              </button>

              <label className="scanner-preset-box upload-box">
                <Upload size={20} color="#1E5AA8" />
                <div>
                  <strong>
                    {lang === 'hi' ? 'स्क्रीनशॉट फोटो अपलोड' : 'Upload Receipt Photo'}
                  </strong>
                  <small>Gemini Vision Forensics</small>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleReceiptImageUpload}
                  style={{ display: 'none' }}
                />
              </label>
            </div>

            {/* Forensic Verdict Card */}
            <div
              className={`fraud-verdict-card ${verifyingReceipt ? 'is-scanning' : ''} ${
                fraudResult?.verdict === 'VERIFIED_GENUINE'
                  ? 'verdict-safe'
                  : fraudResult?.verdict === 'REPLAY_ATTACK'
                    ? 'verdict-warn'
                    : 'verdict-danger'
              }`}
            >
              {verifyingReceipt && <div className="laser-scan-beam" />}

              {verifyingReceipt ? (
                <div className="fraud-verifying-state">
                  <Sparkles size={22} />
                  <strong>
                    {lang === 'hi'
                      ? 'PayPal लेजर और पिक्सेल की जांच हो रही है...'
                      : 'Cross-checking PayPal Webhook Ledger & AI Vision Forensics...'}
                  </strong>
                </div>
              ) : fraudResult ? (
                <>
                  <div className="fraud-verdict-header">
                    <div className="fraud-verdict-badge">
                      {fraudResult.verdict === 'VERIFIED_GENUINE' ? (
                        <ShieldCheck size={20} />
                      ) : fraudResult.verdict === 'REPLAY_ATTACK' ? (
                        <AlertTriangle size={20} />
                      ) : (
                        <ShieldAlert size={20} />
                      )}
                      <span>
                        {lang === 'hi' ? fraudResult.badgeHi : fraudResult.badgeEn}
                      </span>
                    </div>
                    <span className="fraud-risk-pill">
                      Risk: {fraudResult.riskScore}/100
                    </span>
                  </div>

                  <div className="fraud-receipt-meta">
                    <div>
                      <small>{lang === 'hi' ? 'दावा की गई रकम' : 'Claimed Amount'}</small>
                      <strong>
                        {currencySymbol}
                        {fraudResult.claimedAmount}
                      </strong>
                    </div>
                    <div>
                      <small>Transaction ID</small>
                      <code>{fraudResult.claimedTxnId}</code>
                    </div>
                    <div>
                      <small>{lang === 'hi' ? 'समय' : 'Timestamp'}</small>
                      <span>{fraudResult.timestampLabel}</span>
                    </div>
                  </div>

                  <ul className="fraud-checks-list">
                    {(fraudResult.checks || []).map((chk, i) => (
                      <li
                        key={i}
                        className={`fraud-check-item ${chk.passed ? 'passed' : 'failed'}`}
                      >
                        <span className="fraud-check-icon">
                          {chk.passed ? '✅' : '❌'}
                        </span>
                        <span>{lang === 'hi' ? chk.labelHi : chk.labelEn}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="fraud-spoken-box">
                    <span>🔊 {lang === 'hi' ? 'वॉइस अलर्ट:' : 'Spoken Alert:'}</span>
                    <strong>
                      “{lang === 'hi' ? fraudResult.spokenHi : fraudResult.spokenEn}”
                    </strong>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            {/* Step 1: Choose Preset or Upload Photo */}
            <div className="scanner-step-block">
              <div className="scanner-step-label">
                {lang === 'hi'
                  ? '1. कौन सा मेन्यू कार्ड स्कैन करना है?'
                  : '1. Select a Menu Card (or Upload Photo):'}
              </div>
              <div className="scanner-preset-grid">
                <button
                  type="button"
                  className={`scanner-preset-box ${selectedPreset === 'cafeteria' ? 'active' : ''}`}
                  onClick={() => handleScanPreset('cafeteria')}
                >
                  <span className="preset-box-emoji">🏫</span>
                  <div>
                    <strong>College Cafeteria</strong>
                    <small>Dosa, Cold Coffee, Maggi</small>
                  </div>
                </button>

                <button
                  type="button"
                  className={`scanner-preset-box ${selectedPreset === 'chaat' ? 'active' : ''}`}
                  onClick={() => handleScanPreset('chaat')}
                >
                  <span className="preset-box-emoji">🍲</span>
                  <div>
                    <strong>Chaat & Chai Stall</strong>
                    <small>Chaat, Chai, Samosa, Lassi</small>
                  </div>
                </button>

                <button
                  type="button"
                  className={`scanner-preset-box ${selectedPreset === 'juice' ? 'active' : ''}`}
                  onClick={() => handleScanPreset('juice')}
                >
                  <span className="preset-box-emoji">🍹</span>
                  <div>
                    <strong>Juice & Shake Corner</strong>
                    <small>Mango Shake, Ganna Ras</small>
                  </div>
                </button>

                <label className="scanner-preset-box upload-box">
                  <Upload size={20} color="#1E5AA8" />
                  <div>
                    <strong>{lang === 'hi' ? 'मेन्यू फोटो अपलोड' : 'Upload Menu Photo'}</strong>
                    <small>Camera / Gallery (AI OCR)</small>
                  </div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageUpload}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>
            </div>

            {/* Step 2: Extracted Menu Items & Fixed Prices */}
            <div className={`scanned-board-card ${scanning ? 'is-scanning' : ''}`}>
              {scanning && <div className="laser-scan-beam" />}
              <div className="scanned-board-header">
                <div className="scanned-board-top-row">
                  <span className="ai-vision-badge">
                    <Sparkles size={13} />{' '}
                    {scanning
                      ? 'Scanning Menu Card...'
                      : lang === 'hi'
                        ? '2. पहचाने गए आइटम और फिक्स रेट:'
                        : '2. Extracted Menu Items & Fixed Prices:'}
                  </span>
                </div>
                <input
                  type="text"
                  className="scanned-stall-name-input"
                  value={stallName}
                  onChange={(e) => setStallName(e.target.value)}
                  placeholder="Stall or Cafeteria Name"
                  aria-label="Stall or Cafeteria Name"
                />
              </div>

              <div className="scanned-items-grid">
                {items.map((item, idx) => (
                  <div key={idx} className="scanned-item-row">
                    <div className="scanned-item-left">
                      <span className="scanned-item-emoji">{item.emoji || '🍽️'}</span>
                      <span className="scanned-item-name" title={item.name}>
                        {item.name}
                      </span>
                    </div>
                    <div className="scanned-item-right">
                      <span className="currency-prefix">{currencySymbol}</span>
                      <input
                        type="number"
                        min="1"
                        className="scanned-price-input"
                        value={item.price}
                        onChange={(e) => handleUpdateItemPrice(idx, e.target.value)}
                      />
                      <button
                        type="button"
                        className="scanned-delete-btn"
                        onClick={() => handleDeleteItem(idx)}
                        aria-label={`Remove ${item.name}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add custom menu item */}
              <form className="scanned-add-form" onSubmit={handleAddItem}>
                <input
                  type="text"
                  placeholder={
                    lang === 'hi' ? '+ नया आइटम नाम (जैसे: Momos)' : '+ Add item name (e.g. Momos)'
                  }
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  className="scanned-add-name"
                />
                <input
                  type="number"
                  placeholder={`${currencySymbol} Price`}
                  value={newItemPrice}
                  onChange={(e) => setNewItemPrice(e.target.value)}
                  className="scanned-add-price"
                />
                <button type="submit" className="scanned-add-btn">
                  <Plus size={16} /> {lang === 'hi' ? 'जोड़ें' : 'Add'}
                </button>
              </form>
            </div>

            {/* Step 3: Save Button */}
            <button
              type="button"
              className="scanner-confirm-save-btn"
              disabled={saving || scanning}
              onClick={handleSaveMenu}
            >
              <Check size={20} />
              <span>
                {saving
                  ? lang === 'hi'
                    ? 'सेव हो रहा है...'
                    : 'Saving Menu...'
                  : lang === 'hi'
                    ? `मेन्यू सेव करें (${items.length} आइटम)`
                    : `Save Menu & Train Voice AI (${items.length} Items)`}
              </span>
            </button>
          </>
        )}
      </div>
    </div>
  );
}
