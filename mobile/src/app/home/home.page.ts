import { loadLlmModel } from '../services/llm-defaults';
import { VoiceButtonComponent } from '../components/voice-button/voice-button.component';
import { Component, OnDestroy, OnInit, ViewChild } from '@angular/core';
import { Subscription } from 'rxjs';
import { Preferences } from '@capacitor/preferences';
import { normalizeSttMode, ChatService, LlmSettings } from '../services/chat.service';
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
  @ViewChild(VoiceButtonComponent) private voiceButton?: VoiceButtonComponent;

  async ionViewWillEnter(): Promise<void> {
    this.ttsLang = (await Preferences.get({key: 'ttsLang'})).value ?? 'en-US';
  }

  ionViewWillLeave(): void {
    this.voiceButton?.stopCapture();
  }

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
    const sttMode = normalizeSttMode((await Preferences.get({ key: 'sttMode' })).value);
    const llmBaseUrl = (await Preferences.get({ key: 'llmBaseUrl' })).value ?? 'https://api.openai.com/v1';
    const llmApiKey = (await Preferences.get({ key: 'llmApiKey' })).value ?? '';
    const llmModelName = await loadLlmModel(llmBaseUrl, (await Preferences.get({ key: 'llmModelName' })).value);

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
        this.voiceService.speak(resp.text, this.ttsLang).catch(() => {});
      }),
    );
  }

  ngOnDestroy(): void {
    this.subs.forEach(s => s.unsubscribe());
  }
}
