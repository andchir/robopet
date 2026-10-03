import {readFile, writeFile} from 'node:fs/promises';
const path = new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url);
try {
  let text = await readFile(path, 'utf8');
  for (const permission of ['RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS', 'CAMERA', 'INTERNET']) {
    if (!text.includes(`android.permission.${permission}`)) text = text.replace('</manifest>', `    <uses-permission android:name="android.permission.${permission}" />\n</manifest>`);
  }
  await writeFile(path, text);
} catch (error) { if (error.code !== 'ENOENT') throw error; }
