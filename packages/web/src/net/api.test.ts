import { describe, expect, it } from 'vitest';
import { changeTime, decideReport } from './api';

interface Call {
  url: string;
  method: string;
  body: unknown;
}

function fake(status: number, body: unknown = {}) {
  const calls: Call[] = [];
  const fetchFn = (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ) => {
    calls.push({ url, method: init.method, body: JSON.parse(init.body) });
    expect(init.headers['content-type']).toBe('application/json');
    return Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    });
  };
  return { calls, fetchFn };
}

describe('decideReport', () => {
  it('sends the decision to the report through the /api proxy', async () => {
    const { calls, fetchFn } = fake(200);
    expect(await decideReport(3, 'approved', fetchFn)).toEqual({ ok: true });
    expect(calls).toEqual([
      { url: '/api/reports/3/decision', method: 'POST', body: { decision: 'approved' } },
    ]);
  });

  it('explains in Indonesian why the server said no', async () => {
    const missing = await decideReport(
      9,
      'approved',
      fake(404, { error: 'report_not_found' }).fetchFn,
    );
    expect(missing).toEqual({ ok: false, status: 404, message: 'Laporan itu tidak ada.' });
    const decided = await decideReport(
      1,
      'rejected',
      fake(409, { error: 'report_not_submitted' }).fetchFn,
    );
    expect(decided).toMatchObject({
      ok: false,
      status: 409,
      message: 'Laporan itu sudah diputuskan, atau belum sampai di meja bos.',
    });
    const odd = await decideReport(1, 'rejected', fake(400, { error: 'invalid_body' }).fetchFn);
    expect(odd).toMatchObject({ ok: false, status: 400, message: 'Permintaan ditolak server.' });
  });

  it('copes with an answer that is not JSON, and with a server that cannot be reached', async () => {
    const broken = {
      fetchFn: () =>
        Promise.resolve({
          ok: false,
          status: 502,
          json: () => Promise.reject(new Error('no body')),
        }),
    };
    expect(await decideReport(1, 'approved', broken.fetchFn)).toMatchObject({
      ok: false,
      status: 502,
      message: 'Permintaan ditolak server.',
    });
    const down = () => Promise.reject(new TypeError('fetch failed'));
    expect(await decideReport(1, 'approved', down)).toEqual({
      ok: false,
      status: 0,
      message: 'Server tidak bisa dihubungi.',
    });
  });
});

describe('changeTime', () => {
  it('sends the speed, the pause or the jump it is given', async () => {
    const { calls, fetchFn } = fake(200);
    await changeTime({ speed: 600 }, fetchFn);
    await changeTime({ paused: true }, fetchFn);
    await changeTime({ advance_seconds: 1800 }, fetchFn);
    expect(calls).toEqual([
      { url: '/api/time', method: 'POST', body: { speed: 600 } },
      { url: '/api/time', method: 'POST', body: { paused: true } },
      { url: '/api/time', method: 'POST', body: { advance_seconds: 1800 } },
    ]);
  });
});
