import { Component, OnInit } from '@angular/core';
import { Preferences } from '@capacitor/preferences';
import { ChatService } from '../../services/chat.service';

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

  constructor(private chatService: ChatService) {}

  async ngOnInit(): Promise<void> {
    const camera = await Preferences.get({ key: 'cameraPosition' });
    const lang = await Preferences.get({ key: 'ttsLang' });
    const name = await Preferences.get({ key: 'robotName' });

    if (camera.value) this.cameraPosition = camera.value as 'front' | 'rear';
    if (lang.value) this.ttsLang = lang.value;
    if (name.value) this.robotName = name.value;
  }

  async save(): Promise<void> {
    await Preferences.set({ key: 'cameraPosition', value: this.cameraPosition });
    await Preferences.set({ key: 'ttsLang', value: this.ttsLang });
    await Preferences.set({ key: 'robotName', value: this.robotName });

    this.chatService.setLanguage(toLangCode(this.ttsLang));
    this.chatService.setRobotName(this.robotName);
  }
}
