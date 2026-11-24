import { t, type TextKey } from '../i18n';
import { API_BASE } from './url';

// The only things the page sends to the server: the boss's decision on a report, and the time controls
// (brief section 4: no manual triggers). Both go through Vite's proxy at `/api` (decision 028).

export type ApiResult = { ok: true } | { ok: false; status: number; message: string };

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

const KNOWN_ERRORS = new Set(['report_not_found', 'report_not_submitted']);

async function post(path: string, body: unknown, fetchFn: FetchLike): Promise<ApiResult> {
  let response;
  try {
    response = await fetchFn(`${API_BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, message: t('error.network') };
  }
  if (response.ok) return { ok: true };
  let code = '';
  try {
    code = String(((await response.json()) as { error?: unknown }).error ?? '');
  } catch {
    // no readable body: the status alone says enough
  }
  const key: TextKey = KNOWN_ERRORS.has(code) ? (`error.${code}` as TextKey) : 'error.invalid';
  return { ok: false, status: response.status, message: t(key) };
}

const defaultFetch: FetchLike = (url, init) => fetch(url, init);

export function decideReport(
  reportId: number,
  decision: 'approved' | 'rejected',
  fetchFn: FetchLike = defaultFetch,
): Promise<ApiResult> {
  return post(`/reports/${reportId}/decision`, { decision }, fetchFn);
}

export interface TimeRequest {
  speed?: number;
  paused?: boolean;
  advance_seconds?: number;
}

export function changeTime(
  request: TimeRequest,
  fetchFn: FetchLike = defaultFetch,
): Promise<ApiResult> {
  return post('/time', request, fetchFn);
}
