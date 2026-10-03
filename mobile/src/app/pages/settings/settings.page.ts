import { DEFAULT_LLM_MODEL, loadLlmModel } from '../../services/llm-defaults';
import { SupertonicService } from '../../services/supertonic.service';
import { VoiceService } from '../../services/voice.service';
import { GigaAmService } from '../../services/gigaam.service';
import { Component, OnInit } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { firstValueFrom } from 'rxjs';
import { ModalController, ToastController } from '@ionic/angular';
import { TranslocoService } from '@jsverse/transloco';
import { normalizeSttMode, ChatService, LlmSettings, SttMode } from '../../services/chat.service';
import { QrDisplayModalComponent } from './qr-display-modal.component';
import { QrScannerModalComponent } from './qr-scanner-modal.component';

/** Convert a BCP-47 tag like "ru-RU" or "en-US" to the short code "ru" / "en". */
function toLangCode(bcp47: string): string {
  return bcp47.split('-')[0].toLowerCase();
}

@Component({
  selector: 'app-settings',
  templateUrl: './settings.page.html',
  styleUrls: ['./settings.page.scss'],
  standalone: false,
})
export class SettingsPage implements OnInit {
  cameraPosition: 'front' | 'rear' = 'front';
  ttsLang = 'en-US';
  ttsEngine = 'supertonic';
  ttsVoice = 'M1';
  voices = ['M1','M2','M3','M4','M5','F1','F2','F3','F4','F5'];
  previewing = false;
  readonly preparingVoice$ = this.voice.isPreparing$;
  robotName = 'RoboPet';
  sttMode: SttMode = 'gigaam';
  llmBaseUrl = 'https://api.openai.com/v1';
  llmApiKey = '';
  llmModelName = DEFAULT_LLM_MODEL;
  readonly defaultLlmModel = DEFAULT_LLM_MODEL;
  deviceId = '';

  constructor(public gigaam: GigaAmService, public supertonic: SupertonicService, private voice: VoiceService,
    private chatService: ChatService,
    private toastController: ToastController,
    private transloco: TranslocoService,
    private modalController: ModalController,
  ) {}

  async ngOnInit(): Promise<void> {
    this.ttsEngine = (await Preferences.get({key: 'ttsEngine'})).value === 'system' ? 'system' : 'supertonic';
    const savedVoice = (await Preferences.get({key: 'ttsVoice'})).value;
    if (savedVoice && this.voices.includes(savedVoice)) this.ttsVoice = savedVoice;
    const camera = await Preferences.get({ key: 'cameraPosition' });
    const lang = await Preferences.get({ key: 'ttsLang' });
    const name = await Preferences.get({ key: 'robotName' });
    const sttMode = await Preferences.get({ key: 'sttMode' });
    const llmBaseUrl = await Preferences.get({ key: 'llmBaseUrl' });
    const llmApiKey = await Preferences.get({ key: 'llmApiKey' });
    const llmModelName = await Preferences.get({ key: 'llmModelName' });
    const deviceId = await Preferences.get({ key: 'deviceId' });

    if (camera.value) this.cameraPosition = camera.value as 'front' | 'rear';
    if (lang.value) this.ttsLang = lang.value;
    if (name.value) this.robotName = name.value;
    if (sttMode.value) this.sttMode = normalizeSttMode(sttMode.value);
    if (llmBaseUrl.value) this.llmBaseUrl = llmBaseUrl.value;
    if (llmApiKey.value) this.llmApiKey = llmApiKey.value;
    this.llmModelName = await loadLlmModel(this.llmBaseUrl, llmModelName.value);
    if (deviceId.value) this.deviceId = deviceId.value;
  }

  async onSpeechLanguageChange(): Promise<void> {
    if (this.sttMode === 'gigaam') await this.gigaam.checkLanguage(this.ttsLang);
  }

  async previewVoice(): Promise<void> {
    if (this.previewing) {await this.voice.stopSpeaking(); return;}
    this.previewing = true;
    const name = this.robotName.trim() || 'RoboPet';
    try {await this.voice.speak(this.ttsLang.startsWith('ru')
      ? `Привет! Я ${name}. Вот так будет звучать мой голос.`
      : `Hello! I am ${name}. This is how my voice will sound.`, this.ttsLang, this.ttsEngine, this.ttsVoice);
    } finally {this.previewing = false;}
  }
  ionViewWillLeave(): void {if (this.previewing) void this.voice.stopSpeaking();}

  async save(): Promise<void> {
    await this.voice.stopSpeaking();
    await Preferences.set({key: 'ttsEngine', value: this.ttsEngine});
    await Preferences.set({key: 'ttsVoice', value: this.ttsVoice});
    await Preferences.set({ key: 'cameraPosition', value: this.cameraPosition });
    await Preferences.set({ key: 'ttsLang', value: this.ttsLang });
    await Preferences.set({ key: 'robotName', value: this.robotName });
    await Preferences.set({ key: 'sttMode', value: this.sttMode });
    await Preferences.set({ key: 'llmBaseUrl', value: this.llmBaseUrl });
    await Preferences.set({ key: 'llmApiKey', value: this.llmApiKey });
    await Preferences.set({ key: 'llmModelName', value: this.llmModelName });

    const langCode = toLangCode(this.ttsLang);
    this.transloco.setActiveLang(langCode);

    this.chatService.setLanguage(langCode);
    this.chatService.setRobotName(this.robotName);
    this.chatService.setSttMode(this.sttMode);

    const llmSettings: LlmSettings = {
      baseUrl: this.llmBaseUrl,
      apiKey: this.llmApiKey,
      modelName: this.llmModelName,
    };
    this.chatService.setLlmSettings(llmSettings);

    // The newly selected language may still be loading on its first use.
    const message = await firstValueFrom(
      this.transloco.selectTranslate('settings.save-success', {}, langCode),
    );
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      position: 'bottom',
      color: 'success',
    });
    await toast.present();
    await this.onSpeechLanguageChange();
  }

  async showQrCode(): Promise<void> {
    const modal = await this.modalController.create({
      component: QrDisplayModalComponent,
      componentProps: { deviceId: this.deviceId },
    });
    await modal.present();
  }

  async identify(): Promise<void> {
    const modal = await this.modalController.create({
      component: QrScannerModalComponent,
    });
    await modal.present();

    const { data } = await modal.onDidDismiss<string>();
    if (data) {
      this.deviceId = data;
      await Preferences.set({ key: 'deviceId', value: data });
      const message = this.transloco.translate('settings.qr-scan-success');
      const toast = await this.toastController.create({
        message,
        duration: 2000,
        position: 'bottom',
        color: 'success',
      });
      await toast.present();
    }
  }
}
