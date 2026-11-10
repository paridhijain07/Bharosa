import React, { useState, useRef } from 'react';
import { PlusCircle, Mic, Bot, BookOpen, Receipt } from 'lucide-react';
import { isSpeechRecognitionSupported, startSpeechRecognition } from '../lib/speech.js';
import { t } from '../lib/i18n.js';

export const DEMO_ORDER_PRESETS = [
  { labelHi: '🗣️ "दो चाट"', labelEn: '🗣️ "do chaat"', text: 'do chaat' },
  { labelHi: '⭐ "राजू का रोज़ वाला"', labelEn: '⭐ "Raju ka roz wala"', text: 'Raju ka roz wala' },
  { labelHi: '🗣️ "एक चाय और दो समोसा"', labelEn: '🗣️ "ek chai aur do samosa"', text: 'ek chai aur do samosa' },
  { labelHi: '📓 "राजू, 2 चाय, खाता"', labelEn: '📓 "Raju, 2 chai, khata"', text: 'Raju, 2 chai, khata' },
];

export const DEMO_ASSISTANT_PRESETS = [
  { labelHi: '❓ "आज कितना आया?"', labelEn: '❓ "aaj kitna aaya?"', text: 'aaj kitna aaya?' },
  { labelHi: '❓ "कितना बाकी है?"', labelEn: '❓ "how much is pending?"', text: 'how much is pending?' },
  { labelHi: '❓ "कौन कौन उधार में है?"', labelEn: '❓ "kaun kaun udhaar mein hai?"', text: 'kaun kaun udhaar mein hai?' },
  { labelHi: '❓ "राजू का कितना बाकी है?"', labelEn: '❓ "Raju ka kitna baki hai?"', text: 'Raju ka kitna baki hai?' },
  { labelHi: '❓ "सबसे ज़्यादा भीड़ कब थी?"', labelEn: '❓ "when was busiest hour?"', text: 'sabse zyada bheed kab thi?' },
];

/**
 * BottomDock (MicButton) — Part A1.2 & A2:
 * Make Add by tap, Ask Stall, and Khata equal-size buttons around the centre Speak mic.
 * Tapping Speak triggers the full-screen ListeningOverlay in App.jsx.
 */
export default function MicButton({
  lang = 'hi',
  menu = [],
  activeView = 'tabs',
  onSelectView,
  onStartVoiceOrder,
  onSimulateVoiceTranscript,
  onAskAssistant,
  onOpenTapModal,
  isProcessing = false,
  showDemoDrawer = false,
}) {
  const [listeningAsk, setListeningAsk] = useState(false);
  const recognitionRef = useRef(null);
  const supported = isSpeechRecognitionSupported();

  // Dynamic voice presets that adapt to whatever Menu Card was scanned!
  const item0 = menu[0]?.name || 'Chaat';
  const item1 = menu[1]?.name || 'Chai';
  const item2 = menu[2]?.name || 'Samosa';
  const dynamicOrderPresets = [
    {
      labelHi: `🗣️ "2 ${item0} और 1 ${item1}"`,
      labelEn: `🗣️ "2 ${item0} aur 1 ${item1}"`,
      text: `2 ${item0} aur 1 ${item1}`,
    },
    {
      labelHi: `🗣️ "1 ${item1} और 2 ${item2}"`,
      labelEn: `🗣️ "1 ${item1} aur 2 ${item2}"`,
      text: `1 ${item1} aur 2 ${item2}`,
    },
    {
      labelHi: '⭐ "राजू का रोज़ वाला"',
      labelEn: '⭐ "Raju ka roz wala"',
      text: 'Raju ka roz wala',
    },
    {
      labelHi: `📓 "राजू, 2 ${item1}, खाता"`,
      labelEn: `📓 "Raju, 2 ${item1}, khata"`,
      text: `Raju, 2 ${item1}, khata`,
    },
  ];

  const handleAssistantMic = () => {
    if (!supported) {
      onAskAssistant?.(lang === 'hi' ? 'aaj kitna aaya?' : 'how much is collected today?');
      return;
    }
    if (listeningAsk && recognitionRef.current) {
      recognitionRef.current.stop();
      setListeningAsk(false);
      return;
    }

    setListeningAsk(true);
    recognitionRef.current = startSpeechRecognition({
      lang,
      onResult: (transcript) => {
        setListeningAsk(false);
        if (transcript && transcript.trim()) {
          onAskAssistant?.(transcript);
        }
      },
      onError: () => {
        setListeningAsk(false);
      },
      onEnd: () => {
        setListeningAsk(false);
      },
    });
  };

  return (
    <>
      {showDemoDrawer && (
        <div className="demo-presets-drawer" role="region" aria-label="Demo shortcuts">
          <div className="demo-group">
            <span className="demo-group-title">
              {lang === 'hi' ? '🎙️ डेमो वॉइस ऑर्डर:' : '🎙️ Demo Voice Orders:'}
            </span>
            <div className="preset-chips">
              {dynamicOrderPresets.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="preset-chip"
                  onClick={() => onSimulateVoiceTranscript?.(p.text)}
                  disabled={isProcessing}
                >
                  {lang === 'hi' ? p.labelHi : p.labelEn}
                </button>
              ))}
            </div>
          </div>

          <div className="demo-group">
            <span className="demo-group-title">
              {lang === 'hi' ? '🤖 स्टॉल असिस्टेंट सवाल:' : '🤖 Ask Stall Assistant:'}
            </span>
            <div className="preset-chips">
              {DEMO_ASSISTANT_PRESETS.map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="preset-chip preset-chip-ask"
                  onClick={() => onAskAssistant?.(p.text)}
                  disabled={isProcessing}
                >
                  {lang === 'hi' ? p.labelHi : p.labelEn}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      <nav className="bottom-dock" aria-label="Primary stall actions">
        <div className="bottom-dock-inner">
          {/* 1. Add by tap (equal size button) */}
          <button
            type="button"
            className="dock-equal-btn"
            onClick={onOpenTapModal}
            disabled={isProcessing}
          >
            <PlusCircle size={22} aria-hidden="true" />
            <span className="dock-label">{t(lang, 'addByTap')}</span>
          </button>

          {/* 2. Centre Giant Speak Mic */}
          <button
            type="button"
            className="dock-giant-mic"
            onClick={onStartVoiceOrder}
            disabled={isProcessing}
            aria-label={t(lang, 'speakOrder')}
          >
            <Mic size={30} strokeWidth={2.5} aria-hidden="true" />
            <span className="giant-mic-text">{t(lang, 'speakOrder')}</span>
          </button>

          {/* 3. Ask Stall (equal size button) */}
          <button
            type="button"
            className={`dock-equal-btn ${listeningAsk ? 'dock-equal-listening' : ''}`}
            onClick={handleAssistantMic}
            disabled={isProcessing}
            title={t(lang, 'askStall')}
            aria-label={t(lang, 'askStall')}
          >
            <Bot size={22} aria-hidden="true" />
            <span className="dock-label">{t(lang, 'askStall')}</span>
          </button>

          {/* 4. Khata / Orders toggle (equal size button) */}
          <button
            type="button"
            className={`dock-equal-btn ${activeView === 'khata' ? 'dock-side-active' : ''}`}
            onClick={() => onSelectView(activeView === 'khata' ? 'tabs' : 'khata')}
          >
            {activeView === 'khata' ? (
              <Receipt size={22} aria-hidden="true" />
            ) : (
              <BookOpen size={22} aria-hidden="true" />
            )}
            <span className="dock-label">
              {activeView === 'khata' ? t(lang, 'ordersTab') : t(lang, 'khataTab')}
            </span>
          </button>
        </div>
      </nav>
    </>
  );
}
