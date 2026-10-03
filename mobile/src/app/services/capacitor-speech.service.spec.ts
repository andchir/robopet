import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { CapacitorSpeechService } from './capacitor-speech.service';

describe('Capacitor speech release', () => {
  let service: CapacitorSpeechService;
  let plugin: any;
  let listeners: Record<string, (data: any) => void>;
  beforeEach(() => {
    listeners = {};
    plugin = {
      addListener: jasmine.createSpy().and.callFake(async (name: string, callback: (data: any) => void) => {
        listeners[name] = callback;
        return {remove: async () => { delete listeners[name]; }};
      }),
      start: jasmine.createSpy().and.resolveTo(),
      // Android's plugin can leave this promise pending indefinitely.
      stop: jasmine.createSpy().and.returnValue(new Promise(() => {})),
    };
    service = new CapacitorSpeechService({startSession() {}, feedCumulative() {}} as any);
    (service as any).recognition = plugin;
  });
  it('honors release before the plugin finishes starting', fakeAsync(() => {
    let result: string | undefined;
    service.startListening('ru-RU').then(text => result = text);
    service.stopListening();
    flushMicrotasks();
    expect(plugin.stop).toHaveBeenCalledTimes(1);
    listeners['partialResults']({matches: ['Привет']});
    tick(500); flushMicrotasks();
    expect(result).toBe('Привет');
    expect(Object.keys(listeners)).toEqual([]);
  }));
  it('finishes even if the stopped event already arrived before release', fakeAsync(() => {
    let result: string | undefined;
    service.startListening('ru-RU').then(text => result = text);
    flushMicrotasks();
    listeners['listeningState']({status: 'stopped'});
    listeners['partialResults']({matches: ['Вопрос']});
    service.stopListening(); service.stopListening();
    tick(300);
    listeners['partialResults']({matches: ['Вопрос целиком']});
    tick(200); flushMicrotasks();
    expect(result).toBe('Вопрос целиком');
    expect(plugin.stop).toHaveBeenCalledTimes(1);
  }));
  it('cleans up listeners when start fails, allowing a retry', fakeAsync(() => {
    plugin.start.and.rejectWith(new Error('failed'));
    let error: Error | undefined;
    service.startListening('ru-RU').catch(value => error = value);
    flushMicrotasks();
    expect(error?.message).toBe('failed');
    expect(Object.keys(listeners)).toEqual([]);
    plugin.start.and.resolveTo();
    service.startListening('ru-RU'); flushMicrotasks();
    service.stopListening(); tick(500); flushMicrotasks();
    expect(plugin.start).toHaveBeenCalledTimes(2);
  }));
});
