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
  recognition.maxAlternatives = 1;
  recognition.continuous = false;

  let hasFinalResult = false;
  let latestInterim = '';

  recognition.onresult = (event) => {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const res = event.results[i];
      const text = res?.[0]?.transcript || '';
      if (res.isFinal) {
        finalTranscript += text;
      } else {
        interimTranscript += text;
      }
    }

    if (interimTranscript) {
      latestInterim = interimTranscript;
      onInterim?.(interimTranscript);
    }

    if (finalTranscript) {
      hasFinalResult = true;
      onResult?.(finalTranscript.trim());
    }
  };

  recognition.onerror = (event) => {
    if (event.error === 'language-not-supported' && recognition.lang === 'hi-IN') {
      recognition.lang = 'en-IN';
    }
    onError?.(event.error || 'Voice recognition error');
  };

  recognition.onend = () => {
    if (!hasFinalResult) {
      if (latestInterim.trim()) {
        onResult?.(latestInterim.trim());
        onEnd?.();
      } else {
        onEnd?.('');
      }
    } else {
      onEnd?.();
    }
  };

  recognition.start();
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
