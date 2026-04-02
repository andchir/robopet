import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { Preferences } from '@capacitor/preferences';
import { ChatService, LlmSettings, SttMode } from '../services/chat.service';
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
  private ttsLang = 'en-US';
  private subs: Subscription[] = [];

  constructor(
    private chatService: ChatService,
    private emotionService: EmotionService,
    private voiceService: VoiceService,
  ) {}

  async ngOnInit(): Promise<void> {
    const lang = (await Preferences.get({ key: 'ttsLang' })).value ?? 'en-US';
    const robotName = (await Preferences.get({ key: 'robotName' })).value ?? 'RoboPet';
    const sttMode = ((await Preferences.get({ key: 'sttMode' })).value ?? 'native') as SttMode;
    const llmBaseUrl = (await Preferences.get({ key: 'llmBaseUrl' })).value ?? '';
    const llmApiKey = (await Preferences.get({ key: 'llmApiKey' })).value ?? '';
    const llmModelName = (await Preferences.get({ key: 'llmModelName' })).value ?? '';

    this.ttsLang = lang;
    this.chatService.setLanguage(toLangCode(lang));
    this.chatService.setRobotName(robotName);
    this.chatService.setSttMode(sttMode);

    const llmSettings: LlmSettings = {
      baseUrl: llmBaseUrl,
      apiKey: llmApiKey,
      modelName: llmModelName,
    };
    this.chatService.setLlmSettings(llmSettings);

    this.subs.push(
      this.chatService.onResponse$.subscribe((resp: RobotResponse) => {
        this.emotionService.setEmotion(resp.emotion);
        this.voiceService.speak(resp.text, this.ttsLang);
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
  }
}
