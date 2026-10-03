import { Preferences } from '@capacitor/preferences';
import { DEFAULT_LLM_MODEL, loadLlmModel } from './llm-defaults';

describe('LLM default migration', () => {
  const clear = async () => {
    await Preferences.remove({key: 'llmDefaultLunaMigrated'});
    await Preferences.remove({key: 'llmModelName'});
  };
  beforeEach(clear);
  afterEach(clear);
  it('uses Luna for new settings and upgrades the previous OpenAI default once', async () => {
    expect(await loadLlmModel('https://api.openai.com/v1', 'gpt-4o-mini')).toBe(DEFAULT_LLM_MODEL);
    expect((await Preferences.get({key: 'llmModelName'})).value).toBe(DEFAULT_LLM_MODEL);
    expect(await loadLlmModel('https://api.openai.com/v1', 'gpt-4o-mini')).toBe('gpt-4o-mini');
    expect(await loadLlmModel('https://api.openai.com/v1', null)).toBe(DEFAULT_LLM_MODEL);
  });
  it('preserves the model of a custom provider', async () => {
    expect(await loadLlmModel('https://example.test/v1', 'gpt-4o-mini')).toBe('gpt-4o-mini');
  });
  it('preserves another explicitly selected model', async () => {
    expect(await loadLlmModel('https://api.openai.com/v1', 'custom-model')).toBe('custom-model');
  });
});
