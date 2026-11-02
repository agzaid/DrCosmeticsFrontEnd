/**
 * The one place the storefront learns where the LumaBeauty API lives; no other file spells an API address.
 *
 * VITE_API_URL (FrontEnd/.env.development and FrontEnd/.env.production; a shell variable of the same name overrides
 * both) is the API's origin, for example https://api.example.com.
 *  - Built app: the browser calls that origin directly. Empty means the page's own origin, which is how the API host
 *    serves the storefront in production.
 *  - `npm run dev`: the browser stays on the Vite origin and vite.config.ts forwards /api and /media to that address,
 *    so the HttpOnly SameSite=Lax cookies stay first-party and no CORS is needed. The browser therefore uses
 *    relative addresses in development.
 */
import { parseApiOrigin } from './apiOrigin';

const API_PREFIX = '/api/v1';

/** Where the API serves uploaded files (Uploads:PublicBasePath on the API; vite.config.ts forwards the same path). */
const MEDIA_PREFIX = '/media/';

/** Origin that API and media requests go to; '' means the page's own origin. */
export const API_ORIGIN = import.meta.env.DEV ? '' : parseApiOrigin(import.meta.env.VITE_API_URL);

/** Prefix of every API request. */
export const API_BASE = `${API_ORIGIN}${API_PREFIX}`;

/**
 * The address to display for a stored image. Uploads are stored and returned as root-relative paths
 * (/media/<guid>.jpg) that belong to the API host; pasted images are absolute and pass through untouched. Call it
 * only where an image is rendered: stored data must keep the relative form so it survives a change of API address.
 */
export function mediaUrl(url: string | undefined): string | undefined {
  return API_ORIGIN !== '' && url?.startsWith(MEDIA_PREFIX) ? `${API_ORIGIN}${url}` : url;
}
