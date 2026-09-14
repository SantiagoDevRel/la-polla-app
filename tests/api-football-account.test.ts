import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Contador de cuota (2026-09-14, migración 123): /status se pide sin caché de
// Next y la DB recibe el instante de la lectura para sumar solo las reservas
// posteriores. Antes, un /status viejo tras el cambio de día UTC inflaba el
// contador +1.133 con GREATEST.
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: mocks.rpc, from: mocks.from }) }));
import { apiFootballProActive } from '@/lib/api-football/account';

const account = (row: object | null) => mocks.from.mockReturnValue({
  select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }),
});
const status = {
  response: {
    subscription: { plan: 'Pro', end: '2026-10-09T21:02:09+00:00', active: true },
    requests: { current: 863, limit_day: 7500 },
  },
  errors: [],
};
const providerFetch = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-14T00:00:30Z'));
  vi.stubEnv('API_FOOTBALL_KEY', 'test-only');
  vi.stubGlobal('fetch', providerFetch);
  providerFetch.mockImplementation(async () => new Response(JSON.stringify(status), { status: 200 }));
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  account({ plan: 'Pro', plan_expires_at: '2026-10-09T21:02:09+00:00', plan_checked_at: '2026-09-13T23:50:00Z' });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('apiFootballProActive', () => {
  it('pide /status sin caché y registra el instante de la lectura', async () => {
    expect(await apiFootballProActive()).toBe(true);
    const init = providerFetch.mock.calls[0][1] as RequestInit & { next?: unknown };
    expect(init.cache).toBe('no-store');
    expect(init.next).toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith('record_api_football_account', {
      p_plan: 'Pro', p_expires: '2026-10-09T21:02:09+00:00', p_used: 863, p_limit: 7500,
      p_read_at: '2026-09-14T00:00:30.000Z',
    });
  });

  it('con una verificación reciente no consulta el proveedor', async () => {
    account({ plan: 'Pro', plan_expires_at: '2026-10-09T21:02:09+00:00', plan_checked_at: '2026-09-14T00:00:00Z' });
    expect(await apiFootballProActive()).toBe(true);
    expect(providerFetch).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('si la 123 todavía no está aplicada, usa la firma anterior y conserva el plan', async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } })
      .mockResolvedValueOnce({ data: null, error: null });
    expect(await apiFootballProActive()).toBe(true);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc.mock.calls[1][1]).not.toHaveProperty('p_read_at');
  });

  it('otro error de la base no declara el plan activo', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } });
    expect(await apiFootballProActive()).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledOnce();
  });
});
