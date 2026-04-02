import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { Emotion, RobotResponse } from '../models/types';

type Intent = 'greeting' | 'who_are_you' | 'how_are_you' | 'bye' | 'what_can_you_do' | 'default';

const INTENT_EMOTIONS: Record<Intent, Emotion> = {
  greeting: 'happy',
  who_are_you: 'excited',
  how_are_you: 'happy',
  bye: 'sad',
  what_can_you_do: 'excited',
  default: 'thinking',
};

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

function detectIntent(text: string, lang: string): Intent {
  const normalized = text.toLowerCase().trim();
  const langKw = KEYWORDS[lang] ?? KEYWORDS['en'];
  for (const [intent, phrases] of Object.entries(langKw)) {
    for (const phrase of phrases) {
      if (normalized.includes(phrase)) {
        return intent as Intent;
      }
    }
  }
  return 'default';
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export type SttMode = 'whisper' | 'native' | 'capacitor';

@Injectable({ providedIn: 'root' })
export class ChatService {
  private language = 'en';
  private robotName = 'RoboPet';
  private sttMode: SttMode = 'native';
  private readonly response$ = new Subject<RobotResponse>();

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

  processMessage(userText: string): void {
    const intent = detectIntent(userText, this.language);
    const langResponses = RESPONSES[this.language] ?? RESPONSES['en'];
    const phrases = langResponses[intent] ?? langResponses['default'];
    const text = pickRandom(phrases).replace('{name}', this.robotName);
    const emotion = INTENT_EMOTIONS[intent];
    console.log(`[Chat] intent="${intent}" lang="${this.language}" text="${text}"`);
    this.response$.next({ text, emotion });
  }
}
