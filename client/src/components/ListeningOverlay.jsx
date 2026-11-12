import React, { useState } from 'react';
import { Mic, X, CheckCircle2, Send } from 'lucide-react';

/**
 * ListeningOverlay (Part A2):
 * Full-screen overlay when the vendor taps Speak:
 * - Big pulsing mic
 * - Animated sound wave (7 bars with CSS wave animation)
 * - Live transcript updating word-by-word via Web Speech API interim results
 * - Instant "Confirm Spoken Text" button when speech is detected
 * - Quick Spoken Phrase chips + inline input fallback (guarantees 100% reliability even when screen-recording locks the mic)
 */
export default function ListeningOverlay({
  isOpen,
  mode = 'order', // 'order' | 'assistant'
  interimTranscript = '',
  lang = 'hi',
  menu = [],
  onSubmitTranscript,
  onFinishSpeaking,
  onCancel,
}) {
  const [manualText, setManualText] = useState('');

  if (!isOpen) return null;

  const item0 = menu[0]?.name || 'Chaat';
  const item1 = menu[1]?.name || 'Chai';
  const item2 = menu[2]?.name || 'Samosa';

  const quickPhrases =
    mode === 'assistant'
      ? [
          { label: lang === 'hi' ? 'आज कितना आया?' : 'How much collected today?', value: 'aaj kitna aaya?' },
          { label: lang === 'hi' ? 'कौन-कौन उधार में है?' : 'Who is on khata?', value: 'kaun kaun udhaar mein hai?' },
          { label: lang === 'hi' ? 'कितना बाकी है?' : 'How much is pending?', value: 'how much is pending?' },
        ]
      : [
          {
            label: lang === 'hi' ? `"दो ${item0} और एक ${item1}"` : `"2 ${item0} aur 1 ${item1}"`,
            value: `2 ${item0} aur 1 ${item1}`,
          },
          {
            label: lang === 'hi' ? `"एक ${item1} और दो ${item2}"` : `"1 ${item1} aur 2 ${item2}"`,
            value: `1 ${item1} aur 2 ${item2}`,
          },
          {
            label: lang === 'hi' ? `"राजू के खाते में 2 ${item0}"` : `"Raju, 2 ${item0}, khata"`,
            value: `Raju, 2 ${item0}, khata`,
          },
          {
            label: lang === 'hi' ? `"राजू का रोज़ वाला"` : `"Raju ka roz wala"`,
            value: 'Raju ka roz wala',
          },
        ];

  const title =
    mode === 'assistant'
      ? lang === 'hi'
        ? 'हिसाब पूछिए…'
        : 'Ask your stall…'
      : lang === 'hi'
        ? 'ऑर्डर बोलिए…'
        : 'Speak order now…';

  const hint =
    mode === 'assistant'
      ? lang === 'hi'
        ? 'जैसे: "आज कितना आया?" या "कौन कौन उधार में है?"'
        : 'e.g. "How much was collected today?" or "Who is on khata?"'
      : lang === 'hi'
        ? `जैसे: "दो ${item0} और एक ${item1}" या "राजू के खाते में 2 ${item0}"`
        : `e.g. "2 ${item0} and 1 ${item1}" or "Raju 2 ${item0} khata"`;

  const handleConfirmSpoken = (textValue) => {
    const finalVal = (textValue || interimTranscript || manualText || '').trim();
    if (!finalVal) return;
    setManualText('');
    onSubmitTranscript?.(finalVal);
  };

  return (
    <div
      className="listening-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="listening-content" style={{ maxWidth: '500px', width: '94%' }}>
        <div className="listening-mic-ring">
          <div className="listening-mic-core">
            <Mic size={48} strokeWidth={2.5} />
          </div>
        </div>

        <h2 className="listening-title">{title}</h2>

        <div className="sound-wave" aria-hidden="true">
          <span className="wave-bar bar-1" />
          <span className="wave-bar bar-2" />
          <span className="wave-bar bar-3" />
          <span className="wave-bar bar-4" />
          <span className="wave-bar bar-5" />
          <span className="wave-bar bar-6" />
          <span className="wave-bar bar-7" />
        </div>

        <div className="live-transcript-box" aria-live="polite">
          {interimTranscript ? (
            <span className="live-transcript-text">“{interimTranscript}”</span>
          ) : (
            <span className="live-transcript-placeholder">{hint}</span>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            if (interimTranscript && !interimTranscript.startsWith('🎙️')) {
              handleConfirmSpoken(interimTranscript);
            } else {
              onFinishSpeaking?.();
            }
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '8px',
            width: '100%',
            padding: '12px 18px',
            marginBottom: '12px',
            borderRadius: '14px',
            border: 'none',
            background: 'linear-gradient(135deg, #10b981, #059669)',
            color: '#fff',
            fontSize: '1rem',
            fontWeight: 800,
            cursor: 'pointer',
            boxShadow: '0 8px 20px rgba(16, 185, 129, 0.35)',
          }}
        >
          <CheckCircle2 size={20} />
          <span>
            {interimTranscript && !interimTranscript.startsWith('🎙️')
              ? lang === 'hi'
                ? `✓ आगे बढ़ें: "${interimTranscript}"`
                : `✓ Confirm: "${interimTranscript}"`
              : lang === 'hi'
                ? '✓ बोल दिया — ऑर्डर बनाएं (Done Speaking)'
                : '✓ Done Speaking — Create Order'}
          </span>
        </button>

        {/* Quick Voice Phrase Chips for instant 1-tap voice recognition or busy mic fallback */}
        <div
          style={{
            width: '100%',
            background: 'rgba(15, 23, 42, 0.65)',
            border: '1px solid rgba(148, 163, 184, 0.22)',
            borderRadius: '14px',
            padding: '12px',
            marginBottom: '12px',
            textAlign: 'left',
          }}
        >
          <div
            style={{
              fontSize: '0.76rem',
              fontWeight: 700,
              color: '#94a3b8',
              marginBottom: '8px',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            {lang === 'hi'
              ? '🎙️ बोलें या तुरंत ऑर्डर चुनें:'
              : '🎙️ Speak aloud or tap a quick voice phrase:'}
          </div>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '7px',
              marginBottom: '10px',
            }}
          >
            {quickPhrases.map((phrase, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleConfirmSpoken(phrase.value)}
                style={{
                  background: 'rgba(30, 41, 59, 0.9)',
                  border: '1px solid rgba(56, 189, 248, 0.35)',
                  color: '#f8fafc',
                  borderRadius: '999px',
                  padding: '6px 12px',
                  fontSize: '0.84rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {phrase.label}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleConfirmSpoken(manualText);
            }}
            style={{ display: 'flex', gap: '6px' }}
          >
            <input
              type="text"
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              placeholder={
                lang === 'hi'
                  ? `या यहाँ लिखें (जैसे: 2 ${item0} 1 ${item1})...`
                  : `Or type voice command (e.g., 2 ${item0} 1 ${item1})...`
              }
              style={{
                flex: 1,
                background: 'rgba(15, 23, 42, 0.9)',
                border: '1px solid rgba(148, 163, 184, 0.3)',
                borderRadius: '10px',
                padding: '8px 12px',
                color: '#fff',
                fontSize: '0.88rem',
              }}
            />
            <button
              type="submit"
              disabled={!manualText.trim()}
              style={{
                background: manualText.trim() ? '#2563eb' : 'rgba(51, 65, 85, 0.6)',
                color: '#fff',
                border: 'none',
                borderRadius: '10px',
                padding: '0 14px',
                fontWeight: 700,
                cursor: manualText.trim() ? 'pointer' : 'not-allowed',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
              }}
            >
              <Send size={15} />
            </button>
          </form>
        </div>

        <button
          type="button"
          className="btn-listening-cancel"
          onClick={onCancel}
        >
          <X size={22} />
          <span>{lang === 'hi' ? 'रद्द करें (Cancel)' : 'Cancel'}</span>
        </button>
      </div>
    </div>
  );
}
