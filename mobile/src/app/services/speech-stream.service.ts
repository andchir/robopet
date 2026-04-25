import { Injectable, NgZone } from '@angular/core';
import { Observable, Subject } from 'rxjs';

/**
 * Central pub/sub for streaming speech-recognition output to UI components.
 *
 * Each STT backend (native, capacitor, whisper) pushes its partial / final
 * results here, and the visualization component subscribes once. This way the
 * UI stays decoupled from the concrete recognition implementation.
 *
 * Two kinds of events are published:
 *   - `sessionStart$` — fired at the beginning of a fresh recognition cycle.
 *     Subscribers should reset any accumulated word state.
 *   - `wordEmitted$`  — fired for every newly-recognized word (already
 *     diffed against words emitted earlier in the same session).
 */
@Injectable({ providedIn: 'root' })
export class SpeechStreamService {
  private readonly word$ = new Subject<string>();
  private readonly session$ = new Subject<void>();
  /** Number of words already emitted from the current session's transcript. */
  private spokenCount = 0;
  /** Token used to abort an in-flight `streamFinalTranscript` if a new
   *  session starts before it finishes. */
  private streamGeneration = 0;

  constructor(private zone: NgZone) {}

  get wordEmitted$(): Observable<string> {
    return this.word$.asObservable();
  }

  get sessionStart$(): Observable<void> {
    return this.session$.asObservable();
  }

  /**
   * Mark the start of a new recognition session. Subscribers should clear
   * their accumulated transcript state. Any active `streamFinalTranscript`
   * call is invalidated (its remaining words are dropped).
   */
  startSession(): void {
    this.spokenCount = 0;
    this.streamGeneration++;
    this.runInZone(() => this.session$.next());
  }

  /**
   * Feed a cumulative transcript ("word1 word2 word3 …"). Any words that
   * extend the previously-fed transcript for this session are emitted
   * one-by-one via {@link wordEmitted$}.
   */
  feedCumulative(transcript: string): void {
    if (!transcript) return;
    const words = transcript.split(/\s+/).filter(Boolean);
    if (words.length <= this.spokenCount) return;

    this.runInZone(() => {
      while (this.spokenCount < words.length) {
        this.word$.next(words[this.spokenCount]);
        this.spokenCount++;
      }
    });
  }

  /** Emit a single word directly (for callers that already split). */
  emitWord(word: string): void {
    const trimmed = word.trim();
    if (!trimmed) return;
    this.spokenCount++;
    this.runInZone(() => this.word$.next(trimmed));
  }

  /**
   * For backends that produce a single final transcript at the end (e.g.
   * Whisper): start a fresh session and emit the words one-by-one with a
   * small delay so the visualization reads as a stream.
   *
   * If a new {@link startSession} is invoked before this finishes, the
   * remaining words are dropped.
   */
  async streamFinalTranscript(text: string, perWordDelayMs = 380): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;

    this.startSession();
    const generation = this.streamGeneration;
    const words = trimmed.split(/\s+/).filter(Boolean);

    for (const word of words) {
      if (generation !== this.streamGeneration) return;
      this.spokenCount++;
      this.runInZone(() => this.word$.next(word));
      await new Promise(r => setTimeout(r, perWordDelayMs));
    }
  }

  private runInZone(fn: () => void): void {
    if (NgZone.isInAngularZone()) fn();
    else this.zone.run(fn);
  }
}
