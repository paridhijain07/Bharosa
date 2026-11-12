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

function encodePcmToWavBase64(float32Buffers, sampleRate = 16000) {
  let totalLength = 0;
  for (const b of float32Buffers) totalLength += b.length;
  if (totalLength === 0) return null;

  const merged = new Float32Array(totalLength);
  let offset = 0;
  for (const b of float32Buffers) {
    merged.set(b, offset);
    offset += b.length;
  }

  const buffer = new ArrayBuffer(44 + merged.length * 2);
  const view = new DataView(buffer);
  const writeString = (pos, str) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(pos + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + merged.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // Mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, merged.length * 2, true);

  let bytePos = 44;
  for (let i = 0; i < merged.length; i++, bytePos += 2) {
    const s = Math.max(-1, Math.min(1, merged[i]));
    view.setInt16(bytePos, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }

  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Start a hybrid 3-engine voice recognition session:
 * 1. Browser Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`)
 * 2. Browser `AudioContext` 16kHz WAV Recorder + Live Voice Activity Detection -> sends WAV to
 *    `POST /api/tabs/transcribe-audio` which runs BOTH Gemini 2.5 Flash Audio AND Windows Native Offline Speech (`System.Speech.Recognition`)!
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
  let isTranscribing = false;
  let latestTranscript = '';
  let silenceTimer = null;
  let recognition = null;
  let mediaStream = null;
  let audioCtx = null;
  let processorNode = null;
  let pcmBuffers = [];
  let recordedSampleRate = 16000;

  const stopAudioStream = () => {
    if (processorNode) {
      try {
        processorNode.disconnect();
        processorNode.onaudioprocess = null;
      } catch {
        // ignore
      }
      processorNode = null;
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
  };

  const cleanupAll = () => {
    if (silenceTimer) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
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
    stopAudioStream();
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
          }, 1200);
        }
      };

      recognition.onerror = (event) => {
        if (hasFinalResult || isCancelled) return;
        if (event.error === 'language-not-supported' && recognition.lang === 'hi-IN') {
          recognition.lang = 'en-IN';
          try {
            recognition.start();
          } catch {
            // ignore
          }
        }
      };

      recognition.start();
    } catch {
      // Fallback WAV recorder will handle it
    }
  }

  // --- ENGINE 2 & 3: Browser 16kHz PCM WAV Recorder -> Gemini 2.5 Flash + Windows Offline Speech ---
  const flushWavAndTranscribe = async () => {
    if (hasFinalResult || isCancelled || isTranscribing || pcmBuffers.length === 0) return;
    isTranscribing = true;
    const buffersToProcess = pcmBuffers;
    pcmBuffers = [];
    stopAudioStream();

    try {
      const wavBase64 = encodePcmToWavBase64(buffersToProcess, recordedSampleRate);
      if (!wavBase64 || hasFinalResult || isCancelled) return;

      if (!latestTranscript) {
        onInterim?.(
          lang === 'hi' ? '🎙️ AI आपकी आवाज़ समझ रहा है...' : '🎙️ Recognizing your voice...'
        );
      }

      const res = await fetch('/api/tabs/transcribe-audio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64: wavBase64, mimeType: 'audio/wav' }),
      });
      if (hasFinalResult || isCancelled) return;
      const data = await res.json();
      if (data?.recognized && data?.transcript?.trim()) {
        onInterim?.(data.transcript.trim());
        finalizeAndSubmit(data.transcript.trim());
      } else {
        isTranscribing = false;
        onInterim?.(
          lang === 'hi'
            ? '🎙️ आवाज़ साफ़ नहीं आई — फिर से बोलें या नीचे टैप करें'
            : '🎙️ Could not hear clearly — speak again or tap a phrase below'
        );
      }
    } catch {
      isTranscribing = false;
    }
  };

  if (typeof navigator !== 'undefined' && navigator.mediaDevices?.getUserMedia) {
    navigator.mediaDevices
      .getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      .then((stream) => {
        if (hasFinalResult || isCancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        mediaStream = stream;
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return;

        audioCtx = new AudioCtx({ sampleRate: 16000 });
        recordedSampleRate = audioCtx.sampleRate || 16000;
        const source = audioCtx.createMediaStreamSource(stream);
        processorNode = audioCtx.createScriptProcessor(4096, 1, 1);

        let hasSpoken = false;
        let spokenChunks = 0;
        let silentChunksAfterSpeech = 0;

        processorNode.onaudioprocess = (event) => {
          if (hasFinalResult || isCancelled || isTranscribing) return;
          const input = event.inputBuffer.getChannelData(0);
          pcmBuffers.push(new Float32Array(input));

          let sumSq = 0;
          for (let i = 0; i < input.length; i++) {
            sumSq += input[i] * input[i];
          }
          const rms = Math.sqrt(sumSq / input.length);

          if (rms > 0.015) {
            spokenChunks += 1;
            silentChunksAfterSpeech = 0;
            if (spokenChunks >= 2 && !hasSpoken) {
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
            silentChunksAfterSpeech += 1;
            // ~4 chunks at 4096/16000Hz (~1.0s of silence after speech) -> auto-transcribe!
            if (silentChunksAfterSpeech >= 4) {
              if (latestTranscript) {
                finalizeAndSubmit(latestTranscript);
              } else {
                flushWavAndTranscribe();
              }
            }
          }
        };

        source.connect(processorNode);
        processorNode.connect(audioCtx.destination);
      })
      .catch(() => {
        // Ignore if mic permission denied
      });
  }

  return {
    stop: () => {
      if (latestTranscript) {
        finalizeAndSubmit(latestTranscript);
      } else if (pcmBuffers.length > 0) {
        flushWavAndTranscribe();
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
