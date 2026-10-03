import { NgZone } from '@angular/core';
import { GigaAmService } from './gigaam.service';

describe('GigaAM language-driven model selection', () => {
  let service: GigaAmService;
  let request: jasmine.Spy;
  beforeEach(() => {
    service = new GigaAmService({run: (fn: () => void) => fn()} as NgZone);
    request = spyOn<any>(service, 'request');
  });
  it('opens the download dialog for the selected language without downloading', async () => {
    request.and.resolveTo(false);
    await service.checkLanguage('ru-RU');
    expect(service.selectedLanguage).toBe('ru');
    expect(service.dialogOpen).toBeTrue();
    expect(request).toHaveBeenCalledOnceWith('status', 'ru');
  });
  it('prompts for a missing English model after switching from installed Russian', async () => {
    request.and.callFake(async (_type: string, key: string) => key === 'ru');
    await service.checkLanguage('ru-RU');
    expect(service.dialogOpen).toBeFalse();
    await service.checkLanguage('en-US');
    expect(service.selectedLanguage).toBe('en');
    expect(service.dialogOpen).toBeTrue();
    await service.checkLanguage('ru-RU');
    expect(service.dialogOpen).toBeFalse();
  });
  it('does not show the dialog when the model is installed', async () => {
    request.and.resolveTo(true);
    await service.checkLanguage('en-GB');
    expect(service.dialogOpen).toBeFalse();
  });
  it('ignores stale results when languages change quickly', async () => {
    let finish!: (value: boolean) => void;
    request.and.callFake((_type: string, key: string) => key === 'ru'
      ? new Promise<boolean>(resolve => finish = resolve) : Promise.resolve(true));
    const oldCheck = service.checkLanguage('ru');
    await service.checkLanguage('en');
    finish(false); await oldCheck;
    expect(service.selectedLanguage).toBe('en');
    expect(service.dialogOpen).toBeFalse();
  });
});
