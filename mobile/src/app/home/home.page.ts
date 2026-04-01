import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { Preferences } from '@capacitor/preferences';
import { SocketService } from '../services/socket.service';
import { EmotionService } from '../services/emotion.service';
import { VoiceService } from '../services/voice.service';
import { RobotResponse } from '../models/types';

/** Convert a BCP-47 tag like "ru-RU" or "en-US" to the short code "ru" / "en". */
function toLangCode(bcp47: string): string {
  return bcp47.split('-')[0].toLowerCase();
}

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: false,
})
export class HomePage implements OnInit, OnDestroy {
  connected = false;
  private ttsLang = 'en-US';
  private subs: Subscription[] = [];

  constructor(
    private socketService: SocketService,
    private emotionService: EmotionService,
    private voiceService: VoiceService,
  ) {}

  async ngOnInit(): Promise<void> {
    const host = (await Preferences.get({ key: 'serverHost' })).value ?? '192.168.1.100';
    const port = parseInt((await Preferences.get({ key: 'serverPort' })).value ?? '8000', 10);
    const lang = (await Preferences.get({ key: 'ttsLang' })).value ?? 'en-US';
    const robotName = (await Preferences.get({ key: 'robotName' })).value ?? 'RoboPet';

    this.ttsLang = lang;
    this.socketService.setLanguage(toLangCode(lang));
    this.socketService.setRobotName(robotName);
    this.socketService.connect(host, port);

    this.subs.push(
      this.socketService.isConnected$.subscribe(c => this.connected = c),
      this.socketService.onRobotResponse$.subscribe((resp: RobotResponse) => {
        this.emotionService.setEmotion(resp.emotion);
        this.voiceService.speak(resp.text, this.ttsLang);
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
    this.socketService.disconnect();
  }
}
