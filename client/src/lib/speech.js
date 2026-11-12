/**
 * Browser Web Speech API (Recognition + Synthesis), Web Audio API chime,
 * Screen Wake Lock API, and Haptic Vibration helpers.
 */

export function isSpeechRecognitionSupported() {
  return typeof window !== 'undefined';
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
/**
 * Start a hybrid 3-engine voice recognition session:
 * 1. Browser Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`)
 * 2. Windows Native Offline Speech Recognition (`POST /api/tabs/listen-mic`)
 * 3. Browser `MediaRecorder` + Live Voice Activity Detection + Gemini 2.5 Flash Audio (`POST /api/tabs/transcribe-audio`)
 * Whichever engine recognizes speech first wins and submits immediately.
 */
export function startSpeechRecognition({
  lang = 'hi',
  interimResults = true,
  onInterim,
  onResult,
  onError,
  onEnd,
}) {
  let hasFinalResult = false;
  let isCancelled = false;
  let latestTranscript = '';
  let silenceTimer = null;
  let recognition = null;
  let mediaStream = null;
  let mediaRecorder = null;
  let audioCtx = null;
  let vadInterval = null;
  let audioChunks = [];

  const cleanupAll = () => {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
    if (vadInterval) {
      clearInterval(vadInterval);
      vadInterval = null;
    }
    if (recognition) {
      try {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.abort();
      } catch {
        // ignore
      }
      recognition = null;
    }
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try {
        mediaRecorder.stop();
      } catch {
        // ignore
      }
    }
    if (mediaStream) {
      try {
        mediaStream.getTracks().forEach((t) => t.stop());
      } catch {
        // ignore
      }
      mediaStream = null;
    }
    if (audioCtx) {
      try {
        audioCtx.close();
      } catch {
        // ignore
      }
      audioCtx = null;
    }
    fetch('/api/tabs/listen-mic/cancel', { method: 'POST' }).catch(() => {});
  };

  const finalizeAndSubmit = (textToSubmit) => {
    if (hasFinalResult || isCancelled) return;
    const cleaned = (textToSubmit || latestTranscript || '').trim();
    if (!cleaned || cleaned.startsWith('🎙️')) return;
    hasFinalResult = true;
    cleanupAll();
    onResult?.(cleaned);
  };

  // --- ENGINE 1: Browser Web Speech API ---
  const SpeechRecognition =
    typeof window !== 'undefined' &&
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  if (SpeechRecognition) {
    try {
      recognition = new SpeechRecognition();
      recognition.lang = lang === 'hi' ? 'hi-IN' : 'en-IN';
      recognition.interimResults = Boolean(interimResults);
      recognition.maxAlternatives = 3;
      recognition.continuous = true;

      recognition.onresult = (event) => {
        if (hasFinalResult || isCancelled) return;
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
          }, 1400);
        }
      };

      recognition.onerror = (event) => {
        if (hasFinalResult || isCancelled) return;
        if (event.error === 'language-not-supported' && recognition.lang === 'hi-IN') {
          recognition.lang = 'en-IN';
          try {
            recognition.start();
            return;
          } catch {
            // ignore
          }
        }
      };

      recognition.start();
    } catch {
      // Fallback engines 2 & 3 will handle it
    }
  }

  // --- ENGINE 2: Windows Native Offline Speech Recognition (/api/tabs/listen-mic) ---
  const runNativeLoop = async () => {
    while (!hasFinalResult && !isCancelled) {
      try {
        const res = await fetch('/api/tabs/listen-mic', { method: 'POST' });
        if (hasFinalResult || isCancelled) break;
        const data = await res.json();
        if (data?.recognized && data?.transcript?.trim()) {
          const spoken = data.transcript.trim();
          onInterim?.(spoken);
          finalizeAndSubmit(spoken);
          return;
        }
      } catch {
        break;
      }
    }
  };
  runNativeLoop();

  // --- ENGINE 3: Browser MediaRecorder + Live Voice Activity Detection + Gemini Audio ---
  const sendRecordedAudioToGemini = async () => {
    if (hasFinalResult || isCancelled || audioChunks.length === 0) return;
    try {
      const mimeType = mediaRecorder?.mimeType || 'audio/webm';
      const blob = new Blob(audioChunks, { type: mimeType });
      if (blob.size < 800) return;

      if (!latestTranscript) {
        onInterim?.(
          lang === 'hi' ? '🎙️ AI आपकी आवाज़ समझ रहा है...' : '🎙️ Processing your voice...'
        );
      }

      const base64Audio = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });

      if (hasFinalResult || isCancelled || !base64Audio) return;

      const res = await fetch('/api/tabs/transcribe-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64: base64Audio, mimeType }),
      });
      if (hasFinalResult || isCancelled) return;
      const data = await res.json();
      if (data?.recognized && data?.transcript?.trim()) {
        onInterim?.(data.transcript.trim());
        finalizeAndSubmit(data.transcript.trim());
      }
    } catch {
      // ignore
    }
  };

  if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        if (hasFinalResult || isCancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        mediaStream = stream;
        audioChunks = [];
        const preferredMime =
          typeof MediaRecorder !== 'undefined' &&
          MediaRecorder.isTypeSupported?.('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : undefined;
        mediaRecorder = preferredMime
          ? new MediaRecorder(stream, { mimeType: preferredMime })
          : new MediaRecorder(stream);

        mediaRecorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            audioChunks.push(e.data);
          }
        };

        mediaRecorder.onstop = () => {
          sendRecordedAudioToGemini();
        };

        mediaRecorder.start(250);

        // Live Voice Activity Detection (VAD) via Web Audio AnalyserNode
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          audioCtx = new AudioCtx();
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);
          const dataArray = new Uint8Array(analyser.fftSize);

          let hasSpoken = false;
          let spokenFrames = 0;
          let silentFramesAfterSpeech = 0;

          vadInterval = setInterval(() => {
            if (hasFinalResult || isCancelled) return;
            analyser.getByteTimeDomainData(dataArray);
            let sumSquares = 0;
            for (let i = 0; i < dataArray.length; i++) {
              const norm = (dataArray[i] - 128) / 128;
              sumSquares += norm * norm;
            }
            const rms = Math.sqrt(sumSquares / dataArray.length);

            if (rms > 0.022) {
              spokenFrames += 1;
              silentFramesAfterSpeech = 0;
              if (spokenFrames >= 2 && !hasSpoken) {
                hasSpoken = true;
                if (!latestTranscript) {
                  onInterim?.(
                    lang === 'hi'
                      ? '🎙️ आपकी आवाज़ आ रही है... बोलते रहें'
                      : '🎙️ Hearing your voice... keep speaking'
                  );
                }
              }
            } else if (hasSpoken) {
              silentFramesAfterSpeech += 1;
              // 13 frames * 100ms = 1.3s of silence after speaking -> auto-stop & transcribe!
              if (silentFramesAfterSpeech >= 13) {
                clearInterval(vadInterval);
                vadInterval = null;
                if (latestTranscript) {
                  finalizeAndSubmit(latestTranscript);
                } else if (mediaRecorder && mediaRecorder.state === 'recording') {
                  try {
                    mediaRecorder.stop();
                  } catch {
                    // ignore
                  }
                }
              }
            }
          }, 100);
        }
      })
      .catch(() => {
        // Ignore if mic stream unavailable; Engine 2 (Windows Native) still listens
      });
  }

  return {
    stop: () => {
      if (latestTranscript) {
        finalizeAndSubmit(latestTranscript);
      } else if (mediaRecorder && mediaRecorder.state === 'recording') {
        try {
          mediaRecorder.stop();
        } catch {
          cleanupAll();
        }
      } else {
        isCancelled = true;
        cleanupAll();
        onEnd?.();
      }
    },
    abort: () => {
      isCancelled = true;
      cleanupAll();
    },
  };
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
