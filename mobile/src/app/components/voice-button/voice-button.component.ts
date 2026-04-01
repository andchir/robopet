import { Component, OnInit } from '@angular/core';
import { Observable, combineLatest, map } from 'rxjs';
import { VoiceService } from '../../services/voice.service';
import { SocketService } from '../../services/socket.service';
import { WhisperService } from '../../services/whisper.service';

@Component({
  selector: 'app-voice-button',
  templateUrl: './voice-button.component.html',
  standalone: false,
})
export class VoiceButtonComponent implements OnInit {
  isRecording$: Observable<boolean>;
  isLoading$: Observable<boolean>;
  isTranscribing$: Observable<boolean>;

  /** True while the button should be disabled (model loading or STT running). */
  isDisabled$: Observable<boolean>;

  /** Visual state label for template logic. */
  state$: Observable<'idle' | 'recording' | 'loading' | 'transcribing'>;

  private permissionGranted = false;

  constructor(
    private voiceService: VoiceService,
    private socketService: SocketService,
    private whisperService: WhisperService,
  ) {
    this.isRecording$ = this.voiceService.isRecording$;
    this.isLoading$ = this.whisperService.isLoading$;
    this.isTranscribing$ = this.whisperService.isTranscribing$;
    this.isDisabled$ = this.whisperService.isBusy$;

    this.state$ = combineLatest([
      this.isRecording$,
      this.isLoading$,
      this.isTranscribing$,
    ]).pipe(
      map(([recording, loading, transcribing]) => {
        if (recording) return 'recording';
        if (loading) return 'loading';
        if (transcribing) return 'transcribing';
        return 'idle';
      }),
    );
  }

  ngOnInit(): void {
    // Start downloading the model in the background so it's ready when needed.
    this.whisperService.preload();
  }

  async onPress(): Promise<void> {
    if (!this.permissionGranted) {
      console.log('[VoiceButton] Requesting microphone permission…');
      this.permissionGranted = await this.voiceService.requestPermission();
      console.log(`[VoiceButton] Permission ${this.permissionGranted ? 'granted' : 'denied'}`);
      if (!this.permissionGranted) return;
    }
    await this.voiceService.startRecording();
  }

  async onRelease(): Promise<void> {
    const audioBase64 = await this.voiceService.stopRecording();
    if (!audioBase64) {
      console.warn('[VoiceButton] Empty audio — skipping');
      return;
    }

    const lang = this.socketService.getLanguage();
    let text = '';
    try {
      text = await this.whisperService.transcribe(audioBase64, lang);
    } catch (err) {
      console.error('[VoiceButton] Transcription error:', err);
      return;
    }

    if (!text) {
      console.warn('[VoiceButton] Empty transcription — not sending');
      return;
    }

    this.socketService.sendChatMessage(text);
  }
}
