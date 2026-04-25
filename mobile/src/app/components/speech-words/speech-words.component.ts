import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  NgZone,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { Subscription } from 'rxjs';
import { SpeechStreamService } from '../../services/speech-stream.service';

interface SpeechWord {
  id: number;
  text: string;
  rotation: number;
  hue: number;
}

const FLIP_DURATION_MS = 750;
const FLIP_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';
/** Tiny "drop" gesture played on the spotlight before it morphs into the transcript. */
const DROP_DIP_MS = 180;
/** After this much silence the spotlight word auto-drops into the transcript. */
const IDLE_COMMIT_MS = 1200;

/**
 * Reusable visualization for streaming speech-recognition output.
 *
 * Subscribes to {@link SpeechStreamService} and renders:
 *   - a single "spotlight" word that flashes in for each newly-recognized word;
 *   - a flowing transcript of words that have been committed (after a short
 *     idle period or when displaced by the next word).
 *
 * The component is purely presentational — it never starts or stops
 * recognition itself. It just reacts to events on the stream service.
 */
@Component({
  selector: 'app-speech-words',
  templateUrl: './speech-words.component.html',
  styleUrls: ['./speech-words.component.scss'],
  standalone: false,
})
export class SpeechWordsComponent implements OnInit, OnDestroy {
  /** The latest word, displayed big in the center stage. */
  currentWord: SpeechWord | null = null;
  /** All accumulated previous words, rendered as flowing small text. */
  transcript: SpeechWord[] = [];

  @ViewChild('transcriptContainer') transcriptContainer?: ElementRef<HTMLElement>;
  @ViewChild('stageEl') stageEl?: ElementRef<HTMLElement>;

  private nextWordId = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Serializes word arrivals + idle commits so dip / FLIP animations don't race. */
  private commitChain: Promise<void> = Promise.resolve();
  private subs: Subscription[] = [];

  constructor(
    private speechStream: SpeechStreamService,
    private zone: NgZone,
    private cd: ChangeDetectorRef,
    private host: ElementRef<HTMLElement>,
  ) {}

  ngOnInit(): void {
    this.subs.push(
      this.speechStream.sessionStart$.subscribe(() => this.resetStage()),
      this.speechStream.wordEmitted$.subscribe(word => this.addWord(word)),
    );
  }

  ngOnDestroy(): void {
    this.clearIdleTimer();
    this.subs.forEach(s => s.unsubscribe());
  }

  trackById(_index: number, word: SpeechWord): number {
    return word.id;
  }

  // ── Word stage helpers ────────────────────────────────────────────────────

  private addWord(text: string): void {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.enqueue(() => this.processIncomingWord(trimmed));
  }

  /**
   * Serialize all stage mutations behind a single Promise chain so dip and
   * FLIP animations don't race when words arrive rapidly.
   */
  private enqueue(task: () => Promise<void>): void {
    this.commitChain = this.commitChain
      .then(task)
      .catch(err => console.error('[SpeechWords] queue task failed', err));
  }

  private async processIncomingWord(text: string): Promise<void> {
    // Drop the existing spotlight (if any) into the transcript first, then
    // present the new word as the new spotlight.
    await this.commitCurrentToTranscript();

    this.zone.run(() => {
      this.currentWord = {
        id: ++this.nextWordId,
        text,
        rotation: this.randomBetween(-5, 5),
        hue: this.randomBetween(200, 340),
      };
      this.cd.detectChanges();
    });

    this.scheduleIdleCommit();
  }

  /**
   * Play a small "drop" gesture on the spotlight and then move the word into
   * the transcript with a FLIP morph. Safe to call when no spotlight exists.
   */
  private async commitCurrentToTranscript(): Promise<void> {
    this.clearIdleTimer();

    const previous = this.currentWord;
    if (!previous) return;

    const root = this.host.nativeElement;
    const spotlightEl = root.querySelector('.spotlight') as HTMLElement | null;
    if (spotlightEl) {
      try {
        await spotlightEl.animate(
          [
            { transform: 'translate3d(0, 0, 0) scale(1)', filter: 'brightness(1)' },
            {
              transform: 'translate3d(0, -3px, 0) scale(1.02)',
              filter: 'brightness(1.08)',
              offset: 0.3,
            },
            {
              transform: 'translate3d(0, 14px, 0) scale(0.96)',
              filter: 'brightness(0.95)',
            },
          ],
          {
            duration: DROP_DIP_MS,
            easing: 'cubic-bezier(0.55, 0.06, 0.68, 0.19)',
            fill: 'forwards',
          },
        ).finished;
      } catch {
        // Animation can be cancelled if the element is removed mid-animation.
      }
    }

    if (this.currentWord !== previous) return;

    const fromRect = (root.querySelector('.spotlight') as HTMLElement | null)
      ?.getBoundingClientRect() ?? null;

    this.zone.run(() => {
      this.transcript.push(previous);
      this.currentWord = null;
      this.cd.detectChanges();
    });

    if (fromRect) {
      this.flipPreviousIntoTranscript(previous, fromRect);
    }

    this.scrollTranscriptToEnd();
  }

  private scheduleIdleCommit(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      this.enqueue(() => this.commitCurrentToTranscript());
    }, IDLE_COMMIT_MS);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  /**
   * FLIP-animate {@param previous} from its old spotlight position into its
   * new inline position inside the transcript flow.
   */
  private flipPreviousIntoTranscript(previous: SpeechWord, fromRect: DOMRect): void {
    const root = this.host.nativeElement;
    requestAnimationFrame(() => {
      const newEl = root.querySelector(
        `.transcript-word[data-word-id="${previous.id}"]`,
      ) as HTMLElement | null;
      if (!newEl) return;

      const toRect = newEl.getBoundingClientRect();
      if (toRect.width === 0 || toRect.height === 0) return;

      const dx = fromRect.left - toRect.left;
      const dy = fromRect.top - toRect.top;
      const sx = fromRect.width / toRect.width;
      const sy = fromRect.height / toRect.height;
      const scale = Math.max(sx, sy);

      newEl.animate(
        [
          {
            transformOrigin: 'top left',
            transform: `translate(${dx}px, ${dy}px) scale(${scale})`,
            opacity: 1,
            filter: 'blur(0px)',
            offset: 0,
          },
          {
            transformOrigin: 'top left',
            transform: `translate(${dx * 0.15}px, ${dy * 0.15 + 12}px) scale(${scale * 0.4 + 0.6})`,
            opacity: 1,
            filter: 'blur(0.5px)',
            offset: 0.6,
          },
          {
            transformOrigin: 'top left',
            transform: 'translate(0, 0) scale(1)',
            opacity: 1,
            filter: 'blur(0px)',
            offset: 1,
          },
        ],
        {
          duration: FLIP_DURATION_MS,
          easing: FLIP_EASING,
          fill: 'backwards',
        },
      );
    });
  }

  private scrollTranscriptToEnd(): void {
    requestAnimationFrame(() => {
      const el = this.transcriptContainer?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  private resetStage(): void {
    this.clearIdleTimer();
    this.commitChain = Promise.resolve();
    this.zone.run(() => {
      this.currentWord = null;
      this.transcript = [];
      this.nextWordId = 0;
      this.cd.detectChanges();
    });
  }

  private randomBetween(min: number, max: number): number {
    return Math.random() * (max - min) + min;
  }
}
