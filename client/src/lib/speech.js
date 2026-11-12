/**
 * Browser Web Speech API (Recognition + Synthesis), Web Audio API chime,
 * Screen Wake Lock API, and Haptic Vibration helpers.
 */

export function isSpeechRecognitionSupported() {
  return (
    typeof window !== 'undefined' &&
    Boolean(window.SpeechRecognition || window.webkitSpeechRecognition)
  );
}

/**
 * Play a pleasant two-tone payment confirmation chime using the Web Audio API (no external audio asset needed).
 */
export function playPaymentChime() {
  if (typeof window === 'undefined') return;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return;

  try {
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // Two bright ascending notes: C5 (523.25 Hz) -> G5 (783.99 Hz)
    const playTone = (freq, startOffset, duration) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + startOffset);

      gain.gain.setValueAtTime(0.001, now + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.25, now + startOffset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + startOffset + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + startOffset);
      osc.stop(now + startOffset + duration);
    };

    playTone(523.25, 0, 0.16);
    playTone(783.99, 0.14, 0.32);
  } catch {
    // Fail silently if audio context blocked
  }
}

/**
 * Speak a message aloud using SpeechSynthesis and vibrate the device if supported.
 */
export function speakText(text, lang = 'hi', vibratePattern = [180, 80, 180]) {
  if (typeof window === 'undefined') return;

  if (vibratePattern && typeof navigator !== 'undefined' && navigator.vibrate) {
    try {
      navigator.vibrate(vibratePattern);
    } catch {
      // Ignore if vibration blocked
    }
  }

  if (!('speechSynthesis' in window) || !text) return;

  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const targetLang = lang === 'hi' ? 'hi-IN' : 'en-IN';
    utterance.lang = targetLang;
    utterance.rate = 0.95;
    utterance.pitch = 1.0;

    const voices = window.speechSynthesis.getVoices();
    const matchedVoice =
      voices.find((v) => v.lang.toLowerCase().includes(lang === 'hi' ? 'hi' : 'en-in')) ||
      voices.find((v) => v.lang.toLowerCase().startsWith(lang));

    if (matchedVoice) {
      utterance.voice = matchedVoice;
    }

    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.warn('[SpeechSynthesis] Error:', err);
  }
}

/**
 * Start a voice recognition capture session (`hi-IN` with `en-IN` fallback).
 * Supports live word-by-word interim results (`onInterim`) and final transcript (`onResult`).
 */
export function startSpeechRecognition({
  lang = 'hi',
  interimResults = true,
  onInterim,
  onResult,
  onError,
  onEnd,
}) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    onError?.('Speech recognition is not supported in this browser.');
    return null;
  }

  const recognition = new SpeechRecognition();
  recognition.lang = lang === 'hi' ? 'hi-IN' : 'en-IN';
  recognition.interimResults = Boolean(interimResults);
  recognition.maxAlternatives = 3;
  recognition.continuous = true;

  let hasFinalResult = false;
  let latestTranscript = '';
  let silenceTimer = null;

  const finalizeAndSubmit = (textToSubmit) => {
    if (hasFinalResult) return;
    const cleaned = (textToSubmit || latestTranscript || '').trim();
    if (!cleaned) return;
    hasFinalResult = true;
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
    try {
      recognition.stop();
    } catch {
      // ignore
    }
    onResult?.(cleaned);
  };

  recognition.onresult = (event) => {
    let combinedTranscript = '';

    for (let i = 0; i < event.results.length; i++) {
      const res = event.results[i];
      const text = res?.[0]?.transcript || '';
      combinedTranscript += (combinedTranscript ? ' ' : '') + text.trim();
    }

    const cleaned = combinedTranscript.trim();
    if (cleaned) {
      latestTranscript = cleaned;
      onInterim?.(cleaned);

      if (silenceTimer) clearTimeout(silenceTimer);
      silenceTimer = setTimeout(() => {
        finalizeAndSubmit(latestTranscript);
      }, 1600);
    }
  };

  recognition.onerror = (event) => {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
    if (event.error === 'language-not-supported' && recognition.lang === 'hi-IN') {
      recognition.lang = 'en-IN';
      try {
        recognition.start();
        return;
      } catch {
        // fall through
      }
    }
    if (latestTranscript.trim() && !hasFinalResult) {
      finalizeAndSubmit(latestTranscript);
      return;
    }
    onError?.(event.error || 'Voice recognition error');
  };

  recognition.onend = () => {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
    if (!hasFinalResult) {
      if (latestTranscript.trim()) {
        hasFinalResult = true;
        onResult?.(latestTranscript.trim());
        onEnd?.();
      } else {
        onEnd?.('');
      }
    } else {
      onEnd?.();
    }
  };

  try {
    recognition.start();
  } catch (err) {
    onError?.(err?.message || 'mic-start-error');
  }
  return recognition;
}

/**
 * Request a Screen Wake Lock so the vendor's phone or display screen stays awake.
 * Feature-detects and fails silently when unsupported.
 */
export async function requestScreenWakeLock() {
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
    return null;
  }
  try {
    return await navigator.wakeLock.request('screen');
  } catch {
    return null;
  }
}
