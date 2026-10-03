import { fakeAsync, flushMicrotasks, tick } from '@angular/core/testing';
import { ChatService, detectIntent } from './chat.service';
import { RobotResponse } from '../models/types';

describe('Local intent confidence', () => {
  it('matches complete RU/EN questions, including punctuation and apostrophes', () => {
    expect(detectIntent('Что ты умеешь?', 'ru', true)).toBe('what_can_you_do');
    expect(detectIntent('What is your name?', 'en', true)).toBe('who_are_you');
    expect(detectIntent('What’s your name?', 'en', true)).toBe('who_are_you');
    expect(detectIntent('Как дела?', 'ru', true)).toBe('how_are_you');
    expect(detectIntent('Привет!', 'ru', true)).toBe('greeting');
  });
  it('sends extended questions and sparse matches to the API', () => {
    for (const text of ['Привет, расскажи мне сегодня о погоде в Москве', 'Как дела обстоят с изучением космоса сейчас', 'Кто такой Пушкин', 'Что ты можешь рассказать о Луне', 'Пока я готовлю ужин расскажи интересную историю']) {
      expect(detectIntent(text, 'ru', true)).withContext(text).toBe('default');
    }
    expect(detectIntent('What do you know about the moon?', 'en', true)).toBe('default');
    expect(detectIntent('Hello please please please please please please', 'en', true)).toBe('default');
  });
  it('does not mistake substrings for keywords', () => {
    expect(detectIntent('покажи картинку', 'ru')).toBe('default');
    expect(detectIntent('this thing is interesting', 'en')).toBe('default');
  });
  it('uses permissive matching only in light mode', () => {
    expect(detectIntent('Привет расскажи мне про звезды', 'ru')).toBe('greeting');
    expect(detectIntent('Привет расскажи мне про звезды', 'ru', true)).toBe('default');
  });
});

describe('Chat API availability', () => {
  let service: ChatService;
  let responses: RobotResponse[];
  let fetchSpy: jasmine.Spy;
  let online: jasmine.Spy;
  const settings = {baseUrl: 'https://example.test/v1', apiKey: 'test', modelName: 'test'};
  beforeEach(() => {
    service = new ChatService(); service.setLanguage('ru'); service.setLlmSettings(settings);
    responses = []; service.onResponse$.subscribe(r => responses.push(r));
    online = spyOnProperty(navigator, 'onLine', 'get').and.returnValue(true);
    fetchSpy = spyOn(window, 'fetch');
  });
  afterEach(() => service.ngOnDestroy());
  it('never requests API or thinking filler when offline or unconfigured', () => {
    online.and.returnValue(false); service.processMessage('Привет расскажи мне про звезды');
    expect(responses.length).toBe(1); expect(responses[0].emotion).toBe('happy');
    online.and.returnValue(true); service.setLlmSettings({...settings, apiKey: ''});
    service.processMessage('Объясни устройство атома');
    expect(responses.length).toBe(2); expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('uses local replies only for confident online matches', fakeAsync(() => {
    fetchSpy.and.resolveTo({ok: true, json: () => Promise.resolve({choices: [{message: {content: 'API answer'}}]})});
    service.processMessage('Что ты умеешь?'); expect(fetchSpy).not.toHaveBeenCalled();
    service.processMessage('Привет расскажи мне про звезды'); flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(1); expect(responses[responses.length - 1]?.text).toBe('API answer');
  }));
  it('uses the supported low-latency request parameters for Luna', fakeAsync(() => {
    service.setLlmSettings({...settings, modelName: 'gpt-6-luna'});
    fetchSpy.and.resolveTo({ok: true, json: () => Promise.resolve({choices: [{message: {content: 'Ответ'}}]})});
    service.processMessage('Расскажи про Луну'); flushMicrotasks();
    const body = JSON.parse(fetchSpy.calls.mostRecent().args[1].body);
    expect(body.model).toBe('gpt-6-luna');
    expect(body.reasoning_effort).toBe('none');
    expect(body.max_completion_tokens).toBe(150);
    expect(body.max_tokens).toBeUndefined();
  }));
  it('falls back on a failed request and blocks subsequent requests until settings are saved', fakeAsync(() => {
    fetchSpy.and.resolveTo(new Response('', {status: 401}));
    service.processMessage('Привет расскажи мне про звезды'); flushMicrotasks();
    expect(responses[responses.length - 1]?.emotion).toBe('happy');
    service.processMessage('Другой вопрос');
    window.dispatchEvent(new Event('online')); service.processMessage('Еще вопрос');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    service.setLlmSettings(settings); service.processMessage('Еще вопрос'); flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  }));
  it('retries a connection failure only after an online event', fakeAsync(() => {
    fetchSpy.and.rejectWith(new TypeError('Network unavailable'));
    service.processMessage('Расскажи про Луну'); flushMicrotasks();
    service.processMessage('Расскажи про Марс'); expect(fetchSpy).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('online'));
    service.processMessage('Расскажи про Марс'); flushMicrotasks();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  }));
  it('times out into light mode and does not keep trying the unavailable API', fakeAsync(() => {
    fetchSpy.and.callFake((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    service.processMessage('Привет расскажи про Луну'); tick(12000); flushMicrotasks();
    expect(responses[responses.length - 1]?.emotion).toBe('happy');
    service.processMessage('Расскажи про Марс'); expect(fetchSpy).toHaveBeenCalledTimes(1);
  }));
  it('discards an older API reply after a newer local answer', fakeAsync(() => {
    let resolve!: (r: Response) => void;
    fetchSpy.and.returnValue(new Promise<Response>(r => resolve = r));
    service.processMessage('Расскажи про Луну');
    service.processMessage('Привет');
    const count = responses.length;
    resolve(new Response(JSON.stringify({choices: [{message: {content: 'Stale'}}]}))); flushMicrotasks();
    expect(responses.length).toBe(count); expect(service.getHistory().some(m => m.content === 'Stale')).toBeFalse();
  }));
});
