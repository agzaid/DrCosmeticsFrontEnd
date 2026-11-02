/**
 * Central typed transport for the LumaBeauty API.
 * - base address from ./config (the API origin; same origin through the Vite proxy in development)
 * - HttpOnly cookie credentials
 * - antiforgery token bootstrap + automatic single retry after a token refresh
 * - RFC 9457 Problem Details mapped to a typed ApiError
 */

import { API_BASE } from './config';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  // JSON object boundary: values arriving here are untrusted, so shape is re-read below.
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

function readFieldErrors(value: unknown): Record<string, string[]> | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }

  const fields: Record<string, string[]> = {};
  Object.entries(record).forEach(([field, messages]) => {
    if (isStringArray(messages)) {
      fields[field] = messages;
    }
  });

  return Object.keys(fields).length > 0 ? fields : undefined;
}

function readContext(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  return record && Object.keys(record).length > 0 ? record : undefined;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly fields?: Record<string, string[]>;
  readonly context?: Record<string, unknown>;
  readonly traceId?: string;

  constructor(
    status: number,
    code: string,
    detail: string,
    fields?: Record<string, string[]>,
    context?: Record<string, unknown>,
    traceId?: string,
  ) {
    super(detail);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.detail = detail;
    this.fields = fields;
    this.context = context;
    this.traceId = traceId;
  }

  static fromPayload(status: number, payload: unknown): ApiError {
    const record = asRecord(payload);
    const code = typeof record?.errorCode === 'string' ? record.errorCode : 'HttpError';
    const detailCandidate = record?.detail ?? record?.title;
    const detail = typeof detailCandidate === 'string' ? detailCandidate : `Request failed with status ${status}`;

    return new ApiError(
      status,
      code,
      detail,
      readFieldErrors(record?.errors),
      readContext(record?.context),
      typeof record?.traceId === 'string' ? record.traceId : undefined,
    );
  }

  fieldError(field: string): string | undefined {
    return this.fields?.[field]?.[0];
  }
}

let csrfToken: string | null = null;
let csrfRequest: Promise<string> | null = null;

export function invalidateCsrfToken(): void {
  csrfToken = null;
}

export async function getCsrfToken(force = false): Promise<string> {
  if (!force && csrfToken) {
    return csrfToken;
  }

  if (!csrfRequest) {
    csrfRequest = fetch(`${API_BASE}/auth/csrf`, { credentials: 'include' })
      .then(async (response) => {
        if (!response.ok) {
          throw ApiError.fromPayload(response.status, await safeJson(response));
        }

        const record = asRecord(await response.json());
        if (typeof record?.token !== 'string') {
          throw new ApiError(response.status, 'InvalidCsrfResponse', 'The CSRF endpoint returned an unexpected payload.');
        }

        csrfToken = record.token;
        return record.token;
      })
      .finally(() => {
        csrfRequest = null;
      });
  }

  return csrfRequest;
}

const SAFE_METHODS: Record<string, true> = {
  GET: true,
  HEAD: true,
  OPTIONS: true,
};

export interface ApiRequestOptions {
  method?: string;
  body?: unknown;
  formData?: FormData;
  signal?: AbortSignal;
  idempotencyKey?: string;
  retryOnCsrfFailure?: boolean;
}

async function safeJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function apiRequest<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const method = (options.method ?? 'GET').toUpperCase();

  const attempt = async (isRetry: boolean): Promise<T> => {
    const headers: Record<string, string> = { Accept: 'application/json' };
    let body: BodyInit | undefined;

    if (options.formData) {
      body = options.formData;
    } else if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body);
    }

    if (!SAFE_METHODS[method]) {
      headers['X-XSRF-TOKEN'] = await getCsrfToken(isRetry);
    }

    if (options.idempotencyKey) {
      headers['X-Idempotency-Key'] = options.idempotencyKey;
    }

    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body,
      credentials: 'include',
      signal: options.signal,
    });

    if (response.status === 204) {
      return undefined as T;
    }

    const payload = await safeJson(response);

    if (!response.ok) {
      const error = ApiError.fromPayload(response.status, payload);

      if (!isRetry && error.code === 'CsrfVerificationFailed' && options.retryOnCsrfFailure !== false) {
        invalidateCsrfToken();
        return attempt(true);
      }

      throw error;
    }

    return payload as T;
  };

  return attempt(false);
}

export function buildQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();

  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '' || value === 'all') {
      return;
    }
    search.set(key, String(value));
  });

  const query = search.toString();
  return query ? `?${query}` : '';
}
