import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { Preferences } from '@capacitor/preferences';
import { SocketService } from '../services/socket.service';
import { EmotionService } from '../services/emotion.service';
import { VoiceService } from '../services/voice.service';
import { RobotResponse } from '../models/types';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})
export class HomePage implements OnInit, OnDestroy {
  connected = false;
  private subs: Subscription[] = [];

  constructor(
    private socketService: SocketService,
    private emotionService: EmotionService,
    private voiceService: VoiceService,
  ) {}

  async ngOnInit(): Promise<void> {
    const host = (await Preferences.get({ key: 'serverHost' })).value ?? '192.168.1.100';
    const port = parseInt((await Preferences.get({ key: 'serverPort' })).value ?? '8000', 10);

    this.socketService.connect(host, port);

    this.subs.push(
      this.socketService.isConnected$.subscribe(c => this.connected = c),
      this.socketService.onRobotResponse$.subscribe((resp: RobotResponse) => {
        this.emotionService.setEmotion(resp.emotion);
        const lang = 'ru-RU';
        this.voiceService.speak(resp.text, lang);
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
    this.socketService.disconnect();
  }
}
