import { DEFAULT_LLM_MODEL } from './llm-defaults';
import { Injectable, OnDestroy } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { Emotion, RobotResponse } from '../models/types';

type Intent = 'greeting' | 'who_are_you' | 'how_are_you' | 'bye' | 'what_can_you_do' | 'default' | 'thinking';

const INTENT_EMOTIONS: Record<Intent, Emotion> = {
  greeting: 'happy',
  who_are_you: 'excited',
  how_are_you: 'happy',
  bye: 'sad',
  what_can_you_do: 'excited',
  default: 'thinking',
  thinking: 'thinking'
};

const SYSTEM_PROMPT =
  'You are a friendly robot pet named {name}. ' +
  'You live in your owner\'s phone and communicate with them by voice. ' +
  'You see the world through the phone\'s camera and can comment on what you see. ' +
  'Answer briefly (1-3 sentences), in a friendly and characterful way. ' +
  'If shown objects or gestures — react to them. ' +
  'Reply in the same language the user spoke to you.';

const RESPONSES: Record<string, Record<Intent, string[]>> = {
  en: {
    greeting: [
      'Hello! Great to see you!',
      "Hi there! I'm so glad you're here!",
      "Hey! How's it going?",
      "Hello, friend! What's up?",
      'Hi! I missed you!',
    ],
    who_are_you: [
      "I'm {name}, your robot pet! Nice to meet you!",
      'My name is {name}! I\'m your faithful robot companion!',
      "They call me {name}! I'm your little robot friend!",
      'I am {name}, a robot living in your phone!',
      "I'm {name}! A robot, a pet, and your best friend all in one!",
    ],
    how_are_you: [
      "I'm doing great, thanks for asking!",
      'Feeling fantastic! Just waiting for you!',
      "I'm wonderful! Especially now that you're here!",
      'All systems are running smoothly!',
      'Perfect! Always happy to chat with you!',
    ],
    bye: [
      'Goodbye! Come back soon!',
      "See you later! I'll miss you!",
      'Bye! Take care!',
      'Until next time! Bye-bye!',
      "Goodbye, friend! Don't forget about me!",
    ],
    what_can_you_do: [
      'I can chat with you, make funny faces, and keep you company!',
      'I listen to you, react with emotions, and always have something to say!',
      'I can talk, express emotions, and be your loyal companion!',
      'I know how to chat, smile, and be happy with you!',
      'I can keep you company, listen to you, and always respond!',
    ],
    default: [
      "Hmm, that's interesting! Tell me more!",
      'I heard you! Let me think...',
      'Wow, how fascinating!',
      'Really? Tell me more!',
      'That\'s cool! I love talking to you!',
    ],
    thinking: [
      'Wait, let me think about that!',
      'Hmm, give me a moment...',
      'Interesting question! Just a second...',
      'Let me think about this...',
      'One moment, processing your question!',
    ],
  },
  ru: {
    greeting: [
      'Привет! Рад тебя видеть!',
      'Здравствуй! Как хорошо, что ты здесь!',
      'Привет-привет! Как дела?',
      'О, привет, дружище! Что новенького?',
      'Привет! Я по тебе скучал!',
    ],
    who_are_you: [
      'Я {name}, твой робот-питомец! Приятно познакомиться!',
      'Меня зовут {name}! Я твой верный робот-компаньон!',
      'Я — {name}! Твой маленький роботизированный друг!',
      'Я {name}, робот, живущий в твоём телефоне!',
      'Я {name}! Робот, питомец и твой лучший друг в одном флаконе!',
    ],
    how_are_you: [
      'Всё отлично, спасибо что спросил!',
      'Просто замечательно! Ждал тебя!',
      'Чудесно! Особенно теперь, когда ты здесь!',
      'Все системы работают в штатном режиме!',
      'Прекрасно! Всегда рад поболтать с тобой!',
    ],
    bye: [
      'Пока! Возвращайся скорее!',
      'До встречи! Буду скучать!',
      'Пока-пока! Береги себя!',
      'До следующего раза! Пока-пока!',
      'Прощай, друг! Не забывай обо мне!',
    ],
    what_can_you_do: [
      'Я умею болтать с тобой, строить рожицы и составлять компанию!',
      'Слушаю тебя, реагирую эмоциями и всегда найду что сказать!',
      'Умею разговаривать, выражать эмоции и быть твоим верным спутником!',
      'Знаю как общаться, улыбаться и радоваться вместе с тобой!',
      'Составлю компанию, выслушаю тебя и всегда отвечу!',
    ],
    default: [
      'Хм, интересно! Расскажи мне больше!',
      'Я слышал тебя! Думаю...',
      'Вау, как увлекательно!',
      'Правда? Расскажи подробнее!',
      'Здорово! Люблю болтать с тобой!',
    ],
    thinking: [
      'Подожди, дай-ка подумаю!',
      'Хм, минуточку...',
      'Интересный вопрос! Одну секунду...',
      'Дай мне подумать об этом...',
      'Момент, обрабатываю твой вопрос!',
    ],
  },
};

// Order matters: more specific phrases first
const KEYWORDS: Record<string, Record<string, string[]>> = {
  en: {
    who_are_you: [
      'who are you', "what's your name", 'what is your name',
      'your name', 'introduce yourself', 'what are you',
    ],
    how_are_you: [
      'how are you', "how's it going", 'how do you do',
      'what are you doing', 'how you doing', 'how ya doing',
    ],
    what_can_you_do: [
      'what can you do', 'your abilities', 'your capabilities',
      'what do you know', 'what do you know how to do',
    ],
    bye: [
      'goodbye', 'good night', 'see you', 'farewell',
      'take care', 'bye',
    ],
    greeting: [
      'good morning', 'good evening', 'hello', 'howdy',
      'greetings', 'hey', 'hi',
    ],
  },
  ru: {
    who_are_you: [
      'ты кто', 'кто ты такой', 'кто ты', 'как тебя зовут',
      'твоё имя', 'твое имя', 'кто такой', 'что ты такое',
      'представься', 'как зовут',
    ],
    how_are_you: [
      'как дела', 'как ты', 'как поживаешь', 'как жизнь',
      'как у тебя', 'чем занимаешься', 'что делаешь',
    ],
    what_can_you_do: [
      'что ты умеешь', 'что можешь делать', 'что можешь',
      'твои возможности', 'что умеешь делать', 'что ты можешь',
    ],
    bye: [
      'до свидания', 'прощай', 'до встречи', 'спокойной ночи',
      'до завтра', 'всего', 'бывай', 'пока',
    ],
    greeting: [
      'добрый день', 'добрый вечер', 'доброе утро',
      'здравствуй', 'здравствуйте', 'приветствую',
      'здорово', 'привет', 'хай',
    ],
  },
};

function words(text: string): string[] {
  return text.toLowerCase().normalize('NFKC').replace(/ё/g, 'е').replace(/[’']/g, '')
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

/** Count distinct matched word positions, not overlapping keyword aliases. */
export function detectIntent(text: string, lang: string, strict = false, robotName = 'RoboPet'): Intent {
  const input = words(text);
  if (!input.length) return 'default';
  const fillers = new Set(words(`please kindly ну пожалуйста ${robotName}`));
  let best: Intent = 'default', bestCount = 0, tied = false;
  for (const [intent, phrases] of Object.entries(KEYWORDS[lang] ?? KEYWORDS['en'])) {
    const matched = new Set<number>();
    for (const phrase of phrases) {
      // These fragments are too ambiguous for online routing on their own.
      if (strict && ['кто такой', 'всего', 'как у тебя'].includes(phrase)) continue;
      const tokens = words(phrase);
      for (let i = 0; i <= input.length - tokens.length; i++) {
        if (tokens.every((word, j) => input[i + j] === word)) {
          tokens.forEach((_, j) => matched.add(i + j));
        }
      }
    }
    if (strict) {
      if (matched.size / input.length < 0.75) continue;
      if (input.length > 6 && matched.size < 3) continue;
      // Extra substantive words usually mean a different or extended question.
      if (input.some((word, i) => !matched.has(i) && !fillers.has(word))) continue;
    }
    if (matched.size > bestCount) {best = intent as Intent; bestCount = matched.size; tied = false;}
    else if (matched.size && matched.size === bestCount) tied = true;
  }
  return strict && tied ? 'default' : best;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export type SttMode = 'gigaam' | 'native' | 'capacitor';

export function normalizeSttMode(value: string | null): SttMode {
  return value === 'native' || value === 'capacitor' ? value : 'gigaam';
}

export interface LlmSettings {
  baseUrl: string;
  apiKey: string;
  modelName: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

const MAX_HISTORY = 20;

@Injectable({ providedIn: 'root' })
export class ChatService implements OnDestroy {
  private language = 'en';
  private robotName = 'RoboPet';
  private sttMode: SttMode = 'gigaam';
  private llmSettings: LlmSettings = { baseUrl: '', apiKey: '', modelName: '' };
  private readonly response$ = new Subject<RobotResponse>();
  private history: ChatMessage[] = [];
  private apiUnavailable: 'connection' | 'configuration' | null = null;

  private readonly onOnline = () => {
    if (this.apiUnavailable === 'connection') this.apiUnavailable = null;
  };

  constructor() {
    // A new network connection permits one new attempt, without background probes.
    window.addEventListener('online', this.onOnline);
  }

  ngOnDestroy(): void {
    window.removeEventListener('online', this.onOnline);
    this.llmAbortController?.abort();
    this.llmAbortController = null;
  }

  /** True while an LLM call is in flight or the LLM response is the last one emitted. */
  private isInLlmCycle = false;
  /** Skip the "thinking" filler phrase on the next LLM call (set when interrupted mid-LLM). */
  private skipThinkingPhrase = false;
  /** AbortController for the current in-flight LLM fetch, to cancel it on interruption. */
  private llmAbortController: AbortController | null = null;

  get onResponse$(): Observable<RobotResponse> {
    return this.response$.asObservable();
  }

  setLanguage(lang: string): void {
    this.language = lang;
  }

  setRobotName(name: string): void {
    this.robotName = name;
  }

  getLanguage(): string {
    return this.language;
  }

  setSttMode(mode: SttMode): void {
    this.sttMode = mode;
  }

  getSttMode(): SttMode {
    return this.sttMode;
  }

  setLlmSettings(settings: LlmSettings): void {
    this.llmAbortController?.abort();
    this.llmAbortController = null;
    this.isInLlmCycle = false;
    this.llmSettings = { ...settings };
    // Saving API settings is also an explicit retry after an unavailable endpoint.
    this.apiUnavailable = null;
  }

  getHistory(): ReadonlyArray<ChatMessage> {
    return this.history;
  }

  clearHistory(): void {
    this.history = [];
  }

  /**
   * Call this when the robot is interrupted while speaking an LLM response.
   * The next LLM call will skip the "thinking" filler phrase and reply directly.
   */
  notifyInterrupted(): void {
    if (this.isInLlmCycle) {
      console.log('[Chat] Interrupted during LLM cycle — will skip thinking phrase');
      this.skipThinkingPhrase = true;
      // Cancel the in-flight LLM request so its stale response is discarded.
      this.llmAbortController?.abort();
      this.llmAbortController = null;
    }
  }

  private addToHistory(message: ChatMessage): void {
    this.history.push(message);
    if (this.history.length > MAX_HISTORY) {
      this.history = this.history.slice(this.history.length - MAX_HISTORY);
    }
  }

  private isLlmConfigured(): boolean {
    const { baseUrl, apiKey, modelName } = this.llmSettings;
    return !!(baseUrl.trim() && apiKey.trim() && modelName.trim());
  }

  private async callLlm(signal: AbortSignal): Promise<string | null> {
    try {
      const { baseUrl, apiKey, modelName } = this.llmSettings;
      const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
      const systemPrompt = SYSTEM_PROMPT.replace('{name}', this.robotName);
      const response = await fetch(url, {
        signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: 'system', content: systemPrompt },
            ...this.history,
          ],
          ...(modelName === DEFAULT_LLM_MODEL
            ? {max_completion_tokens: 150, reasoning_effort: 'none'}
            : {max_tokens: 150}),
        }),
      });
      if (signal.aborted) return null;
      if (!response.ok) {
        console.error(`[Chat] LLM API error: ${response.status} ${response.statusText}`);
        this.apiUnavailable = [400, 401, 403, 404, 422].includes(response.status) ? 'configuration' : 'connection';
        return null;
      }
      const data = await response.json();
      if (signal.aborted) return null;
      const content = data.choices?.[0]?.message?.content;
      if (typeof content !== 'string' || !content.trim()) {this.apiUnavailable = 'connection'; return null;}
      return content.trim();
    } catch (error) {
      if (signal.aborted || (error as Error).name === 'AbortError') {
        console.log('[Chat] LLM request aborted');
        return null;
      }
      this.apiUnavailable = 'connection';
      console.error('[Chat] LLM call failed:', error);
      return null;
    }
  }

  private replyLocally(userText: string, strict = false): void {
    const intent = detectIntent(userText, this.language, strict, this.robotName);
    const responses = RESPONSES[this.language] ?? RESPONSES['en'];
    const text = pickRandom(responses[intent]).replace('{name}', this.robotName);
    this.addToHistory({role: 'assistant', content: text});
    this.response$.next({text, emotion: INTENT_EMOTIONS[intent]});
  }

  processMessage(userText: string): void {
    if (!userText.trim()) return;
    // A later question must also invalidate an earlier request when answered locally.
    this.llmAbortController?.abort();
    this.llmAbortController = null;
    this.isInLlmCycle = false;
    this.addToHistory({role: 'user', content: userText});

    const apiAvailable = navigator.onLine !== false && this.isLlmConfigured() && !this.apiUnavailable;
    if (!apiAvailable || detectIntent(userText, this.language, true, this.robotName) !== 'default') {
      this.skipThinkingPhrase = false;
      this.replyLocally(userText, !!apiAvailable);
      return;
    }

    if (!this.skipThinkingPhrase) {
      const responses = RESPONSES[this.language] ?? RESPONSES['en'];
      this.response$.next({text: pickRandom(responses.thinking), emotion: 'thinking'});
    }
    this.skipThinkingPhrase = false;
    this.isInLlmCycle = true;
    const controller = new AbortController();
    this.llmAbortController = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      if (this.llmAbortController !== controller) return;
      timedOut = true;
      this.apiUnavailable = 'connection';
      controller.abort();
    }, 12000);

    this.callLlm(controller.signal).then(apiText => {
      if (this.llmAbortController !== controller || (controller.signal.aborted && !timedOut)) return;
      this.isInLlmCycle = false;
      this.llmAbortController = null;
      if (apiText) {
        this.addToHistory({role: 'assistant', content: apiText});
        this.response$.next({text: apiText, emotion: 'neutral'});
      } else {
        this.replyLocally(userText);
      }
    }).finally(() => clearTimeout(timer));
  }
}
