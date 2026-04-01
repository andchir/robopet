import { Component } from '@angular/core';
import { VoiceService } from '../../services/voice.service';
import { SocketService } from '../../services/socket.service';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-voice-button',
  templateUrl: './voice-button.component.html',
  standalone: false,
})
export class VoiceButtonComponent {
  isRecording$: Observable<boolean>;
  private permissionGranted = false;

  constructor(
    private voiceService: VoiceService,
    private socketService: SocketService,
  ) {
    this.isRecording$ = this.voiceService.isRecording$;
  }

  async onPress(): Promise<void> {
    if (!this.permissionGranted) {
      this.permissionGranted = await this.voiceService.requestPermission();
      if (!this.permissionGranted) return;
    }
    await this.voiceService.startRecording();
  }

  async onRelease(): Promise<void> {
    const audioBase64 = await this.voiceService.stopRecording();
    this.socketService.sendAudioData(audioBase64);
  }
}
