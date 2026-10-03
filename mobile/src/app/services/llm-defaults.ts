import { Preferences } from '@capacitor/preferences';

export const DEFAULT_LLM_MODEL = 'gpt-6-luna';

/** Upgrade the former OpenAI default once; preserve custom providers and later choices. */
export async function loadLlmModel(baseUrl: string, saved: string | null): Promise<string> {
  const marker = 'llmDefaultLunaMigrated';
  const migrated = (await Preferences.get({key: marker})).value;
  let model = saved || DEFAULT_LLM_MODEL;
  let officialOpenAi = false;
  try {officialOpenAi = new URL(baseUrl).hostname === 'api.openai.com';} catch { /* Custom/empty URL. */ }
  if (!migrated) {
    if (model === 'gpt-4o-mini' && officialOpenAi) {
      model = DEFAULT_LLM_MODEL;
      await Preferences.set({key: 'llmModelName', value: model});
    }
    await Preferences.set({key: marker, value: '1'});
  }
  return model;
}
