import type { Language } from '../types';

/** Where the visitor's chosen language is kept. The language context writes it; the API client reads it. */
export const LANGUAGE_STORAGE_KEY = 'luma_language';

/**
 * The language the visitor chose. The API client sends it as `Accept-Language` so the server words the messages it
 * returns (a refused upload, a validation error, "sign in to continue") in that language rather than in the browser's.
 */
export function readStoredLanguage(): Language {
  return localStorage.getItem(LANGUAGE_STORAGE_KEY) === 'ar' ? 'ar' : 'en';
}
