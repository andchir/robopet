import { Component, OnInit } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { ToastController } from '@ionic/angular';
import { TranslocoService } from '@jsverse/transloco';
import { ChatService, LlmSettings, SttMode } from '../../services/chat.service';

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
  robotName = 'RoboPet';
  sttMode: SttMode = 'native';
  llmBaseUrl = 'https://api.openai.com/v1';
  llmApiKey = '';
  llmModelName = 'gpt-4o-mini';
  deviceId = '';

  constructor(
    private chatService: ChatService,
    private toastController: ToastController,
    private transloco: TranslocoService,
  ) {}

  async ngOnInit(): Promise<void> {
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
    if (sttMode.value) this.sttMode = sttMode.value as SttMode;
    if (llmBaseUrl.value) this.llmBaseUrl = llmBaseUrl.value;
    if (llmApiKey.value) this.llmApiKey = llmApiKey.value;
    if (llmModelName.value) this.llmModelName = llmModelName.value;
    if (deviceId.value) this.deviceId = deviceId.value;
  }

  async save(): Promise<void> {
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

    const message = this.transloco.translate('settings.save-success');
    const toast = await this.toastController.create({
      message,
      duration: 2000,
      position: 'bottom',
      color: 'success',
    });
    await toast.present();
  }
}
