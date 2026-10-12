import type { DatabaseSync } from 'node:sqlite';

import { DEFAULT_SETTINGS, SettingsSchema } from '@nova/core';
import type { Settings, SettingsPatch } from '@nova/core';

import { log } from '../log';
import { inTransaction } from './transaction';

type SettingKey = keyof Settings;

const isSettingKey = (key: string): key is SettingKey => Object.hasOwn(SettingsSchema.shape, key);

/**
 * Settings stored one JSON value per key. Missing keys use {@link DEFAULT_SETTINGS};
 * unknown keys (from a newer or older app version) are ignored; invalid values fall back
 * to the default and are logged by key only.
 */
export class SettingsRepo {
  constructor(private readonly db: DatabaseSync) {}

  get(): Settings {
    const settings: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const row of this.db.prepare('SELECT key, value FROM settings').all()) {
      const { key, value } = row;
      if (typeof key !== 'string' || typeof value !== 'string' || !isSettingKey(key)) {
        continue;
      }
      const parsed = SettingsSchema.shape[key].safeParse(parseJson(value));
      if (parsed.success) {
        settings[key] = parsed.data;
      } else {
        log.warn('ignoring invalid stored setting', { key });
      }
    }
    return SettingsSchema.parse(settings);
  }

  /** Writes the keys present in `patch` (already validated) and returns the full settings. */
  update(patch: SettingsPatch): Settings {
    const upsert = this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    inTransaction(this.db, () => {
      for (const [key, value] of Object.entries(patch)) {
        // `.partial()` lets `{ key: undefined }` through; that means "unchanged", not "store null".
        if (value !== undefined) {
          upsert.run(key, JSON.stringify(value));
        }
      }
    });
    return this.get();
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // Converted to "invalid value": the caller falls back to the default and logs the key.
    return undefined;
  }
}
