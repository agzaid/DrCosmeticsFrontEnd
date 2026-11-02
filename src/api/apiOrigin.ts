/**
 * Validates and normalizes the API address (VITE_API_URL). Pure, with no Vite or browser globals, because both the
 * app (config.ts) and the Vite configuration (vite.config.ts) use it.
 *
 * Returns the origin without a trailing slash, or '' for an empty value (the page's own origin). Throws for anything
 * that is not an origin such as https://api.example.com. A path is rejected on purpose: pasting the Swagger page's
 * address would otherwise build requests like https://host/swagger/index.html/api/v1/... that only fail in the
 * browser, after the build has shipped.
 */
export function parseApiOrigin(value: string | undefined): string {
  const text = (value ?? '').trim();
  if (text === '') {
    return '';
  }

  let url: URL | undefined;
  try {
    url = new URL(text);
  } catch {
    url = undefined;
  }

  if (!url || !/^https?:$/.test(url.protocol) || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error(
      `VITE_API_URL must be empty or an origin such as https://api.example.com (scheme, host and optional port, no path), not "${text}".`,
    );
  }

  return url.origin;
}
