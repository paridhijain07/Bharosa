import React, { useState, useEffect } from 'react';
import {
  Store,
  Mic,
  CheckCircle2,
  ShieldCheck,
  Camera,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  X,
  Upload,
  Plus,
  Trash2,
  Zap,
  Phone,
} from 'lucide-react';
import {
  isSpeechRecognitionSupported,
  startSpeechRecognition,
} from '../lib/speech.js';

const VOICE_PROFILE_PRESETS = [
  {
    id: 'cafeteria',
    labelHi: '🎙️ "कैंपस कैफेटेरिया, प्रिया वर्मा"',
    labelEn: '🎙️ "Campus Cafeteria, Priya Verma"',
    stallName: 'Campus Cafeteria & Coffee Bar',
    ownerName: 'Priya Verma',
    phone: '+919820112233',
    city: 'Bengaluru',
    category: 'cafeteria',
    paypalEmail: 'priya.cafeteria@sandbox.paypal.com',
  },
  {
    id: 'chaat',
    labelHi: '🎙️ "शर्मा जी चाट स्टॉल, शर्मा जी"',
    labelEn: '🎙️ "Sharma Ji Chaat Stall"',
    stallName: 'Sharma Ji Chaat & Chai Stall',
    ownerName: 'Sharma Ji',
    phone: '+919811122233',
    city: 'New Delhi',
    category: 'chaat',
    paypalEmail: 'sharmaji.stall@sandbox.paypal.com',
  },
  {
    id: 'juice',
    labelHi: '🎙️ "फ्रेश जूस कॉर्नर, राजेश कुमार"',
    labelEn: '🎙️ "Fresh Juice Corner, Rajesh"',
    stallName: 'Fresh Juice & Shake Corner',
    ownerName: 'Rajesh Kumar',
    phone: '+919876501234',
    city: 'Mumbai',
    category: 'juice',
    paypalEmail: 'rajesh.juice@sandbox.paypal.com',
  },
];

export default function VendorOnboardingModal({
  isOpen,
  onClose,
  vendor,
  lang = 'hi',
  onChangeLang,
  currencySymbol = '₹',
  onRegistered,
}) {
  const [step, setStep] = useState(1); // 1: Identity & OTP, 2: PayPal Connect, 3: AI Menu Setup
  const [stallName, setStallName] = useState(vendor?.name || 'Sharma Ji Chaat & Chai Stall');
  const [ownerName, setOwnerName] = useState(vendor?.ownerName || 'Sharma Ji');
  const [phone, setPhone] = useState(vendor?.phone || '+919811122233');
  const [city, setCity] = useState(vendor?.city || 'New Delhi');
  const [category, setCategory] = useState(vendor?.category || 'chaat');

  // OTP state
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState('4210');
  const [otpVerified, setOtpVerified] = useState(true);
  const [listeningVoice, setListeningVoice] = useState(false);

  // Step 2: PayPal Merchant OAuth state
  const [paypalEmail, setPaypalEmail] = useState(
    vendor?.paypalEmail || 'sharmaji.stall@sandbox.paypal.com'
  );
  const [paypalMerchantId, setPaypalMerchantId] = useState(
    vendor?.paypalMerchantId || 'PPMERCHANT-IN-SHARMA01'
  );
  const [paypalConnecting, setPaypalConnecting] = useState(false);
  const [paypalConnected, setPaypalConnected] = useState(true);

  // Step 3: Menu Setup state
  const [items, setItems] = useState(vendor?.menu || []);
  const [scanningMenu, setScanningMenu] = useState(false);
  const [newItemName, setNewItemName] = useState('');
  const [newItemPrice, setNewItemPrice] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen && vendor) {
      setStallName(vendor.name || 'Sharma Ji Chaat & Chai Stall');
      setOwnerName(vendor.ownerName || 'Sharma Ji');
      setPhone(vendor.phone || '+919811122233');
      setCity(vendor.city || 'New Delhi');
      setCategory(vendor.category || 'chaat');
      setPaypalEmail(vendor.paypalEmail || 'sharmaji.stall@sandbox.paypal.com');
      setPaypalMerchantId(vendor.paypalMerchantId || 'PPMERCHANT-IN-SHARMA01');
      setItems(vendor.menu || []);
    }
  }, [isOpen, vendor]);

  if (!isOpen) return null;

  const handleLoadMenuPreset = async (presetKey) => {
    setCategory(presetKey);
    setScanningMenu(true);
    try {
      const res = await fetch('/api/vendor/scan-menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ presetKey }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.items)) {
        setTimeout(() => {
          setItems(data.items);
          setScanningMenu(false);
        }, 350);
      } else {
        setScanningMenu(false);
      }
    } catch {
      setScanningMenu(false);
    }
  };

  const handleApplyVoicePreset = async (preset) => {
    setStallName(preset.stallName);
    setOwnerName(preset.ownerName);
    setPhone(preset.phone);
    setCity(preset.city);
    setCategory(preset.category);
    setPaypalEmail(preset.paypalEmail);
    setPaypalMerchantId(
      `PPMERCHANT-IN-${preset.id.toUpperCase()}-${Math.floor(100 + Math.random() * 900)}`
    );
    setOtpVerified(true);
    await handleLoadMenuPreset(preset.category);
  };

  const handleSpeakStallDetails = () => {
    if (!isSpeechRecognitionSupported()) {
      handleApplyVoicePreset(VOICE_PROFILE_PRESETS[0]);
      return;
    }
    setListeningVoice(true);
    startSpeechRecognition({
      lang: lang === 'hi' ? 'hi-IN' : 'en-IN',
      onResult: (finalTranscript) => {
        setListeningVoice(false);
        if (finalTranscript && finalTranscript.trim()) {
          const parts = finalTranscript.split(/,|aur|and|-/i).map((s) => s.trim());
          if (parts[0]) setStallName(parts[0]);
          if (parts[1]) setOwnerName(parts[1]);
          setOtpVerified(true);
        }
      },
      onError: () => {
        setListeningVoice(false);
      },
      onEnd: () => {
        setListeningVoice(false);
      },
    });
  };

  const handleConnectPayPalOAuth = () => {
    setPaypalConnecting(true);
    setTimeout(() => {
      const slug = (stallName || 'BHAROSA')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase()
        .slice(0, 6);
      setPaypalMerchantId(`PPMERCHANT-IN-${slug || 'STALL'}-982`);
      if (!paypalEmail.includes('@')) {
        setPaypalEmail(`${slug.toLowerCase()}@sandbox.paypal.com`);
      }
      setPaypalConnected(true);
      setPaypalConnecting(false);
    }, 550);
  };

  const handleImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setScanningMenu(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await fetch('/api/vendor/scan-menu', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageBase64: reader.result }),
        });
        const data = await res.json();
        if (res.ok && Array.isArray(data.items)) {
          setItems(data.items);
        }
      } finally {
        setScanningMenu(false);
      }
    };
    reader.readAsDataURL(file);
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

  const handleCompleteRegistration = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/vendor/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          stallName,
          ownerName,
          phone,
          city,
          category,
          language: lang,
          paypalEmail,
          paypalMerchantId,
          items,
          presetKey: category,
        }),
      });
      const data = await res.json();
      if (res.ok && data.vendor) {
        try {
          localStorage.setItem('bharosa_onboarded', '1');
        } catch {
          // ignore
        }
        onRegistered?.(data);
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal-backdrop scanner-backdrop-centered"
      role="dialog"
      aria-modal="true"
      aria-label="Vendor Registration and Onboarding"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="menu-scanner-card onboarding-wizard-card">
        {/* Top Header */}
        <div className="scanner-card-header">
          <div>
            <span className="scanner-step-pill">
              <Store size={14} />{' '}
              {lang === 'hi'
                ? '45-सेकंड स्टॉल रजिस्ट्रेशन और PayPal ऑनबोर्डिंग'
                : '45-Sec Vendor Registration & PayPal Onboarding'}
            </span>
            <h2 className="scanner-main-title">
              {lang === 'hi'
                ? '🏪 नया स्टॉल रजिस्टर करें या बदलें'
                : '🏪 Register or Switch Your Stall'}
            </h2>
            <p className="scanner-sub-text">
              {lang === 'hi'
                ? 'बिना लंबे फॉर्म भरे बोलकर अपनी दुकान रजिस्टर करें, PayPal जोड़ें और मेन्यू फोटो स्कैन करें।'
                : 'Zero-typing onboarding: Speak your stall details, link PayPal Sandbox in 1 click, and scan your menu card.'}
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

        {/* 3-Step Progress Bar */}
        <div className="onboarding-steps-bar" role="tablist">
          <button
            type="button"
            className={`onboarding-step-tab ${step === 1 ? 'active' : ''} ${step > 1 ? 'done' : ''}`}
            onClick={() => setStep(1)}
          >
            <span className="step-num-circle">{step > 1 ? '✓' : '1'}</span>
            <span>{lang === 'hi' ? 'दुकान और फ़ोन OTP' : 'Stall & Phone OTP'}</span>
          </button>
          <button
            type="button"
            className={`onboarding-step-tab ${step === 2 ? 'active' : ''} ${step > 2 ? 'done' : ''}`}
            onClick={() => setStep(2)}
          >
            <span className="step-num-circle">{step > 2 ? '✓' : '2'}</span>
            <span>{lang === 'hi' ? 'PayPal खाता जोड़ें' : 'Connect PayPal'}</span>
          </button>
          <button
            type="button"
            className={`onboarding-step-tab ${step === 3 ? 'active' : ''}`}
            onClick={() => setStep(3)}
          >
            <span className="step-num-circle">3</span>
            <span>{lang === 'hi' ? 'मेन्यू और Voice AI' : 'Menu & Voice AI'}</span>
          </button>
        </div>

        {/* STEP 1: Stall Details + Voice Auto-Fill + Mobile OTP */}
        {step === 1 && (
          <div className="onboarding-step-body">
            <div className="onboarding-lang-strip">
              <span>{lang === 'hi' ? 'भाषा चुनें / Choose Language:' : 'Choose Stall Language:'}</span>
              <div className="onboarding-lang-pills">
                <button
                  type="button"
                  className={`onboarding-lang-btn ${lang === 'hi' ? 'active' : ''}`}
                  onClick={() => onChangeLang?.('hi')}
                >
                  🇮🇳 हिंदी (Hindi)
                </button>
                <button
                  type="button"
                  className={`onboarding-lang-btn ${lang === 'en' ? 'active' : ''}`}
                  onClick={() => onChangeLang?.('en')}
                >
                  🇬🇧 English
                </button>
              </div>
            </div>

            {/* Speak to Fill or 1-Tap Voice Presets */}
            <div className="onboarding-voice-box">
              <div className="onboarding-voice-header">
                <button
                  type="button"
                  className={`onboarding-mic-btn ${listeningVoice ? 'listening' : ''}`}
                  onClick={handleSpeakStallDetails}
                >
                  <Mic size={18} />
                  <span>
                    {listeningVoice
                      ? lang === 'hi'
                        ? 'सुन रहे हैं... दुकान का नाम बोलें'
                        : 'Listening... Speak stall & owner name'
                      : lang === 'hi'
                        ? '🎙️ बोलकर फॉर्म भरें (Speak to Fill)'
                        : '🎙️ Speak to Auto-Fill Stall Details'}
                  </span>
                </button>
                <small>
                  {lang === 'hi'
                    ? 'या नीचे 1-क्लिक डेमो प्रोफाइल चुनें:'
                    : 'Or tap a 1-click demo vendor profile:'}
                </small>
              </div>

              <div className="onboarding-preset-chips">
                {VOICE_PROFILE_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={`onboarding-preset-chip ${stallName === p.stallName ? 'active' : ''}`}
                    onClick={() => handleApplyVoicePreset(p)}
                  >
                    {lang === 'hi' ? p.labelHi : p.labelEn}
                  </button>
                ))}
              </div>
            </div>

            {/* Form Fields */}
            <div className="onboarding-form-grid">
              <label className="onboarding-field">
                <span>{lang === 'hi' ? 'दुकान / कैफेटेरिया का नाम *' : 'Stall / Cafeteria Name *'}</span>
                <input
                  type="text"
                  value={stallName}
                  onChange={(e) => setStallName(e.target.value)}
                  placeholder="e.g. Campus Cafeteria & Coffee Bar"
                />
              </label>

              <label className="onboarding-field">
                <span>{lang === 'hi' ? 'मालिक का नाम *' : 'Vendor / Owner Name *'}</span>
                <input
                  type="text"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="e.g. Priya Verma"
                />
              </label>

              <label className="onboarding-field">
                <span>{lang === 'hi' ? 'मोबाइल नंबर (WhatsApp) *' : 'Mobile Number (WhatsApp) *'}</span>
                <div className="onboarding-phone-row">
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+919876543210"
                  />
                  <button
                    type="button"
                    className="onboarding-otp-btn"
                    onClick={() => {
                      setOtpSent(true);
                      setOtpCode('4210');
                      setOtpVerified(true);
                    }}
                  >
                    <Phone size={14} />{' '}
                    {otpVerified
                      ? lang === 'hi'
                        ? '✓ OTP सत्यापित'
                        : '✓ OTP Verified'
                      : lang === 'hi'
                        ? 'OTP भेजें'
                        : 'Verify OTP'}
                  </button>
                </div>
              </label>

              <label className="onboarding-field">
                <span>{lang === 'hi' ? 'शहर / लोकेशन' : 'City / Market Location'}</span>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="e.g. New Delhi"
                />
              </label>
            </div>

            {otpSent && (
              <div className="onboarding-otp-banner">
                <CheckCircle2 size={16} />
                <span>
                  {lang === 'hi'
                    ? `मोबाइल ${phone} OTP #${otpCode} से सत्यापित हो गया!`
                    : `Mobile ${phone} verified via instant Sandbox OTP #${otpCode}!`}
                </span>
              </div>
            )}

            <button
              type="button"
              className="scanner-confirm-save-btn"
              onClick={() => setStep(2)}
            >
              <span>
                {lang === 'hi'
                  ? 'अगला कदम: PayPal खाता जोड़ें'
                  : 'Next Step: Connect PayPal Account'}
              </span>
              <ArrowRight size={18} />
            </button>
          </div>
        )}

        {/* STEP 2: Connect PayPal Business / Sandbox Account */}
        {step === 2 && (
          <div className="onboarding-step-body">
            <div className="onboarding-paypal-card">
              <div className="onboarding-paypal-top">
                <div>
                  <span className="wc-paypal-pill">💙 PAYPAL COMMERCE ONBOARDING</span>
                  <h3>
                    {lang === 'hi'
                      ? 'अपना PayPal मर्चेंट खाता जोड़ें'
                      : 'Link Your PayPal Merchant Account'}
                  </h3>
                  <p>
                    {lang === 'hi'
                      ? 'यह आपके हर ऑर्डर के लिए डायनामिक QR कोड बनाएगा, वेबहुक से असली पेमेंट वेरिफाई करेगा और PayPal वर्किंग कैपिटल लोन अनलॉक करेगा।'
                      : 'Enables dynamic Orders v2 QR codes, cryptographic webhook verification, and PayPal Working Capital micro-loans.'}
                  </p>
                </div>
              </div>

              <div className="onboarding-form-grid">
                <label className="onboarding-field">
                  <span>{lang === 'hi' ? 'PayPal मर्चेंट ईमेल' : 'PayPal Merchant Email'}</span>
                  <input
                    type="email"
                    value={paypalEmail}
                    onChange={(e) => setPaypalEmail(e.target.value)}
                    placeholder="merchant@sandbox.paypal.com"
                  />
                </label>

                <label className="onboarding-field">
                  <span>PayPal Merchant ID (Sandbox)</span>
                  <input
                    type="text"
                    value={paypalMerchantId}
                    onChange={(e) => setPaypalMerchantId(e.target.value)}
                    placeholder="PPMERCHANT-IN-01"
                  />
                </label>
              </div>

              <button
                type="button"
                className={`onboarding-paypal-connect-btn ${paypalConnected ? 'connected' : ''}`}
                onClick={handleConnectPayPalOAuth}
                disabled={paypalConnecting}
              >
                <Zap size={18} />
                <span>
                  {paypalConnecting
                    ? lang === 'hi'
                      ? 'PayPal Sandbox से जुड़ रहा है...'
                      : 'Connecting to PayPal Sandbox OAuth...'
                    : paypalConnected
                      ? lang === 'hi'
                        ? `✓ PayPal जुड़ा हुआ है (${paypalMerchantId}) — री-लिंक करें`
                        : `✓ PayPal Sandbox Connected (${paypalMerchantId})`
                      : lang === 'hi'
                        ? '1-क्लिक में PayPal Sandbox जोड़ें'
                        : '1-Click Connect with PayPal Sandbox'}
                </span>
              </button>

              <div className="onboarding-paypal-perks">
                <div>
                  <ShieldCheck size={16} />
                  <span>
                    {lang === 'hi'
                      ? 'Webhook-Only पेमेंट सुरक्षा + नकली स्क्रीनशॉट बचाव'
                      : 'Webhook-Only Truth + Fake Screenshot Protection'}
                  </span>
                </div>
                <div>
                  <Sparkles size={16} />
                  <span>
                    {lang === 'hi'
                      ? 'Bharosa स्कोर के आधार पर प्री-अप्रूव्ड माइक्रो-लोन'
                      : 'Pre-Qualified PayPal Working Capital Micro-Loans'}
                  </span>
                </div>
              </div>
            </div>

            <div className="onboarding-nav-row">
              <button
                type="button"
                className="onboarding-back-btn"
                onClick={() => setStep(1)}
              >
                <ArrowLeft size={16} /> {lang === 'hi' ? 'पीछे' : 'Back'}
              </button>

              <button
                type="button"
                className="scanner-confirm-save-btn"
                onClick={() => setStep(3)}
              >
                <span>
                  {lang === 'hi'
                    ? 'अगला कदम: मेन्यू और Voice AI सेट करें'
                    : 'Next Step: Setup Menu & Voice AI'}
                </span>
                <ArrowRight size={18} />
              </button>
            </div>
          </div>
        )}

        {/* STEP 3: Scan Menu Card or Pick Stall Template */}
        {step === 3 && (
          <div className="onboarding-step-body">
            <div className="scanner-step-label">
              {lang === 'hi'
                ? 'अपनी दुकान का मेन्यू चुनें या मेन्यू कार्ड की फोटो अपलोड करें:'
                : 'Select your stall category or upload a photo of your menu board:'}
            </div>

            <div className="scanner-preset-grid">
              <button
                type="button"
                className={`scanner-preset-box ${category === 'cafeteria' ? 'active' : ''}`}
                onClick={() => handleLoadMenuPreset('cafeteria')}
              >
                <span className="preset-box-emoji">🏫</span>
                <div>
                  <strong>College Cafeteria</strong>
                  <small>Dosa, Cold Coffee, Maggi</small>
                </div>
              </button>

              <button
                type="button"
                className={`scanner-preset-box ${category === 'chaat' ? 'active' : ''}`}
                onClick={() => handleLoadMenuPreset('chaat')}
              >
                <span className="preset-box-emoji">🍲</span>
                <div>
                  <strong>Chaat & Chai Stall</strong>
                  <small>Chaat, Chai, Samosa, Lassi</small>
                </div>
              </button>

              <button
                type="button"
                className={`scanner-preset-box ${category === 'juice' ? 'active' : ''}`}
                onClick={() => handleLoadMenuPreset('juice')}
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
                  <strong>{lang === 'hi' ? 'मेन्यू फोटो स्कैन' : 'Scan Menu Photo'}</strong>
                  <small>Gemini Vision OCR</small>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  style={{ display: 'none' }}
                />
              </label>
            </div>

            <div className={`scanned-board-card ${scanningMenu ? 'is-scanning' : ''}`}>
              {scanningMenu && <div className="laser-scan-beam" />}
              <div className="scanned-items-grid">
                {items.map((item, idx) => (
                  <div key={idx} className="scanned-item-row">
                    <div className="scanned-item-left">
                      <span className="scanned-item-emoji">{item.emoji || '🍽️'}</span>
                      <span className="scanned-item-name">{item.name}</span>
                    </div>
                    <div className="scanned-item-right">
                      <span className="currency-prefix">{currencySymbol}</span>
                      <input
                        type="number"
                        min="1"
                        className="scanned-price-input"
                        value={item.price}
                        onChange={(e) => {
                          const val = Number(e.target.value) || 0;
                          setItems((prev) =>
                            prev.map((it, i) => (i === idx ? { ...it, price: val } : it))
                          );
                        }}
                      />
                      <button
                        type="button"
                        className="scanned-delete-btn"
                        onClick={() => setItems((prev) => prev.filter((_, i) => i !== idx))}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              <form className="scanned-add-form" onSubmit={handleAddItem}>
                <input
                  type="text"
                  placeholder={lang === 'hi' ? '+ नया आइटम (जैसे: Momos)' : '+ New item (e.g. Momos)'}
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
                  <Plus size={15} /> {lang === 'hi' ? 'जोड़ें' : 'Add'}
                </button>
              </form>
            </div>

            <div className="onboarding-nav-row">
              <button
                type="button"
                className="onboarding-back-btn"
                onClick={() => setStep(2)}
              >
                <ArrowLeft size={16} /> {lang === 'hi' ? 'पीछे' : 'Back'}
              </button>

              <button
                type="button"
                className="scanner-confirm-save-btn"
                disabled={submitting}
                onClick={handleCompleteRegistration}
              >
                <CheckCircle2 size={20} />
                <span>
                  {submitting
                    ? lang === 'hi'
                      ? 'स्टॉल शुरू हो रहा है...'
                      : 'Launching Stall...'
                    : lang === 'hi'
                      ? `🚀 ${stallName} शुरू करें (${items.length} आइटम)`
                      : `🚀 Launch ${stallName} (${items.length} Items)`}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
