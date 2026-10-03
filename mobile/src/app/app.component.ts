import { SupertonicService } from './services/supertonic.service';
import { normalizeSttMode } from './services/chat.service';
import { GigaAmService } from './services/gigaam.service';
import { Component, OnInit } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { TranslocoService } from '@jsverse/transloco';

@Component({
  selector: 'app-root',
  templateUrl: 'app.component.html',
  styleUrls: ['app.component.scss'],
  standalone: false,
})
export class AppComponent implements OnInit {
  constructor(private transloco: TranslocoService, public gigaam: GigaAmService, public supertonic: SupertonicService) {}

  async ngOnInit(): Promise<void> {
    const { value: deviceId } = await Preferences.get({ key: 'deviceId' });
    if (!deviceId) {
      await Preferences.set({ key: 'deviceId', value: crypto.randomUUID() });
    }

    const { value: ttsLang } = await Preferences.get({ key: 'ttsLang' });
    const language = ttsLang ?? 'en-US';
    this.transloco.setActiveLang(language.split('-')[0].toLowerCase());
    const { value: mode } = await Preferences.get({ key: 'sttMode' });
    if (normalizeSttMode(mode) === 'gigaam') await this.gigaam.checkLanguage(language);
  }
}
