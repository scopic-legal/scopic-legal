/**
 * Wraps `window.fetch` to attach the CSRF token (read from the
 * `scopic.csrf` cookie) on every same-origin POST/PUT/PATCH/DELETE.
 * Imported once for its side effects from `main.tsx`.
 */

const COOKIE_NAME = 'scopic.csrf';
const HEADER_NAME = 'X-CSRF-Token';
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function readCsrfToken(): string {
  const prefix = `${COOKIE_NAME}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }
  return '';
}

function isSameOrigin(input: RequestInfo | URL): boolean {
  try {
    const url =
      typeof input === 'string'
        ? new URL(input, window.location.origin)
        : input instanceof URL
          ? input
          : new URL(input.url, window.location.origin);
    return url.origin === window.location.origin;
  } catch {
    return false;
  }
}

const original = window.fetch.bind(window);

window.fetch = async function csrfFetch(input, init) {
  const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (!UNSAFE_METHODS.has(method) || !isSameOrigin(input)) {
    return original(input, init);
  }

  const token = readCsrfToken();
  if (!token) {
    return original(input, init);
  }

  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
  if (!headers.has(HEADER_NAME)) {
    headers.set(HEADER_NAME, token);
  }
  return original(input, { ...init, headers });
};
