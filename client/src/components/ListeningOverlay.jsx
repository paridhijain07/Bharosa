import React from 'react';
import { Mic, X } from 'lucide-react';

/**
 * ListeningOverlay (Part A2):
 * Full-screen overlay when the vendor taps Speak:
 * - Big pulsing mic
 * - Animated sound wave (7 bars with CSS wave animation)
 * - Live transcript updating word-by-word via Web Speech API interim results
 * - Clear Cancel button
 */
export default function ListeningOverlay({
  isOpen,
  mode = 'order', // 'order' | 'assistant'
  interimTranscript = '',
  lang = 'hi',
  onCancel,
}) {
  if (!isOpen) return null;

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
        ? 'जैसे: "दो चाट" या "राजू का रोज़ वाला"'
        : 'e.g. "do chaat" or "Raju ka roz wala"';

  return (
    <div
      className="listening-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="listening-content">
        <div className="listening-mic-ring">
          <div className="listening-mic-core">
            <Mic size={52} strokeWidth={2.5} />
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
          className="btn-listening-cancel"
          onClick={onCancel}
        >
          <X size={24} />
          <span>{lang === 'hi' ? 'रद्द करें (Cancel)' : 'Cancel'}</span>
        </button>
      </div>
    </div>
  );
}

