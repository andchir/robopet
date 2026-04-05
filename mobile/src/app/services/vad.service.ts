import { Injectable, NgZone } from '@angular/core';
import { Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class VadService {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private scriptProcessor: ScriptProcessorNode | null = null;

  private isSpeechActive = false;
  private aboveThresholdSince: number | null = null;
  private belowThresholdSince: number | null = null;

  /** RMS energy threshold — values above this are considered "sound". */
  private readonly THRESHOLD = 0.015;
  /** Accumulated sound must cover this window before speech-start fires (ms). */
  private readonly ONSET_MS = 280;
  /**
   * During onset accumulation, brief dips below threshold are tolerated for
   * up to this long before the onset timer resets. Handles natural speech gaps.
   */
  private readonly ONSET_GRACE_MS = 200;
  /** Sound must stay below threshold for this long before speech-end fires (ms). */
  private readonly RELEASE_MS = 800;

  private tickCount = 0;

  private readonly speechStartSubject = new Subject<void>();
  private readonly speechEndSubject = new Subject<void>();

  readonly onSpeechStart$ = this.speechStartSubject.asObservable();
  readonly onSpeechEnd$ = this.speechEndSubject.asObservable();

  constructor(private ngZone: NgZone) {}

  /** Returns the active microphone MediaStream, or null if VAD is not running. */
  getStream(): MediaStream | null {
    return this.stream;
  }

  async start(): Promise<void> {
    console.log('[VAD] start() called, stream already exists:', !!this.stream);
    if (this.stream) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      console.error('[VAD] navigator.mediaDevices.getUserMedia is NOT available');
      return;
    }

    try {
      console.log('[VAD] Requesting microphone…');
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      console.log('[VAD] Microphone granted, tracks:', this.stream.getTracks().map(t => `${t.kind}:${t.label}:${t.readyState}`));

      this.audioContext = new AudioContext();
      console.log('[VAD] AudioContext created, state:', this.audioContext.state, 'sampleRate:', this.audioContext.sampleRate);

      // AudioContext may start suspended on mobile — resume it explicitly.
      if (this.audioContext.state !== 'running') {
        console.log('[VAD] AudioContext not running, resuming…');
        await this.audioContext.resume();
        console.log('[VAD] AudioContext state after resume:', this.audioContext.state);
      }

      this.audioContext.onstatechange = () => {
        console.log('[VAD] AudioContext state changed to:', this.audioContext?.state);
      };

      const source = this.audioContext.createMediaStreamSource(this.stream);

      // ScriptProcessorNode works reliably on Android WebView, unlike AnalyserNode
      // whose getFloatTimeDomainData() returns all zeros in that environment.
      // Buffer size 2048 ≈ 42–47 ms per callback at 44.1–48 kHz.
      // eslint-disable-next-line deprecation/deprecation
      this.scriptProcessor = this.audioContext.createScriptProcessor(2048, 1, 1);

      // Route through a silent gain node so onaudioprocess fires without
      // feeding the microphone back through the speaker.
      const silentGain = this.audioContext.createGain();
      silentGain.gain.value = 0;
      source.connect(this.scriptProcessor);
      this.scriptProcessor.connect(silentGain);
      silentGain.connect(this.audioContext.destination);

      this.isSpeechActive = false;
      this.aboveThresholdSince = null;
      this.belowThresholdSince = null;
      this.tickCount = 0;

      this.scriptProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
        this.processAudio(event.inputBuffer.getChannelData(0));
      };

      console.log(
        `[VAD] ScriptProcessor ready — bufferSize=2048, threshold=${this.THRESHOLD},` +
        ` onset=${this.ONSET_MS}ms, release=${this.RELEASE_MS}ms`,
      );
    } catch (err) {
      console.error('[VAD] Failed to start:', err);
    }
  }

  stop(): void {
    console.log('[VAD] stop() called');
    if (this.scriptProcessor) {
      this.scriptProcessor.onaudioprocess = null;
      this.scriptProcessor.disconnect();
      this.scriptProcessor = null;
    }
    this.stream?.getTracks().forEach(t => { t.stop(); console.log('[VAD] Track stopped:', t.label); });
    this.stream = null;
    this.audioContext?.close().catch(() => {});
    this.audioContext = null;
    this.isSpeechActive = false;
    this.aboveThresholdSince = null;
    this.belowThresholdSince = null;
    console.log('[VAD] Stopped and cleaned up');
  }

  private processAudio(data: Float32Array): void {
    let sumSq = 0;
    for (let i = 0; i < data.length; i++) {
      sumSq += data[i] ** 2;
    }
    const rms = Math.sqrt(sumSq / data.length);
    const now = Date.now();
    this.tickCount++;

    // Log RMS roughly every ~1 second (≈ 22 callbacks/s at 2048 samples / 44.1 kHz)
    if (this.tickCount % 22 === 0) {
      const bar = '█'.repeat(Math.min(Math.round(rms * 400), 30));
      console.log(`[VAD] RMS=${rms.toFixed(4)} ${bar}  speaking=${this.isSpeechActive}  ctx=${this.audioContext?.state}`);
    }

    const isSound = rms > this.THRESHOLD;

    if (!this.isSpeechActive) {
      // ── Onset phase: accumulate sound, tolerate brief dips ──────────────
      if (isSound) {
        if (!this.aboveThresholdSince) {
          this.aboveThresholdSince = now;
          this.belowThresholdSince = null;
          console.log(`[VAD] Onset started (RMS=${rms.toFixed(4)}), need ${this.ONSET_MS}ms…`);
        } else {
          // Brief dip ended — clear it, continue accumulating
          this.belowThresholdSince = null;
          const onsetMs = now - this.aboveThresholdSince;
          if (onsetMs >= this.ONSET_MS) {
            this.isSpeechActive = true;
            this.aboveThresholdSince = null;
            this.belowThresholdSince = null;
            console.log(`[VAD] >>> SPEECH START (RMS=${rms.toFixed(4)})`);
            this.ngZone.run(() => this.speechStartSubject.next());
          }
        }
      } else {
        // Below threshold during onset — allow a grace period before resetting
        if (this.aboveThresholdSince !== null) {
          if (!this.belowThresholdSince) {
            this.belowThresholdSince = now;
          } else if (now - this.belowThresholdSince >= this.ONSET_GRACE_MS) {
            console.log(`[VAD] Onset reset after ${this.ONSET_GRACE_MS}ms silence (RMS=${rms.toFixed(4)})`);
            this.aboveThresholdSince = null;
            this.belowThresholdSince = null;
          }
        }
      }
    } else {
      // ── Speech active: detect end ────────────────────────────────────────
      if (isSound) {
        this.belowThresholdSince = null;
      } else {
        if (!this.belowThresholdSince) {
          this.belowThresholdSince = now;
          console.log(`[VAD] Silence detected (RMS=${rms.toFixed(4)}), waiting ${this.RELEASE_MS}ms…`);
        } else if (now - this.belowThresholdSince >= this.RELEASE_MS) {
          this.isSpeechActive = false;
          this.belowThresholdSince = null;
          this.aboveThresholdSince = null;
          console.log(`[VAD] <<< SPEECH END`);
          this.ngZone.run(() => this.speechEndSubject.next());
        }
      }
    }
  }
}
