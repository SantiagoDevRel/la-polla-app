import { afterEach, describe, expect, it, vi } from 'vitest';
import { autoUpdateKey, canAutoUpdate, fetchAppVersion, refreshApp } from '@/lib/app-update';
import { GET } from '@/app/api/app-version/route';

afterEach(() => vi.unstubAllGlobals());

describe('deployment updates', () => {
  it('only updates on entry and preserves edits, with a per-build loop guard', () => {
    const storage = { getItem: vi.fn().mockReturnValue(null) };
    expect(canAutoUpdate('a', 'b', true, false, storage)).toBe(true);
    expect(canAutoUpdate('a', 'a', true, false, storage)).toBe(false);
    expect(canAutoUpdate('a', 'b', false, false, storage)).toBe(false);
    expect(canAutoUpdate('a', 'b', true, true, storage)).toBe(false);
    storage.getItem.mockReturnValue('attempted');
    expect(canAutoUpdate('a', 'b', true, false, storage)).toBe(false);
    expect(storage.getItem).toHaveBeenLastCalledWith(autoUpdateKey('a', 'b'));
    storage.getItem.mockImplementation(() => { throw Error('blocked'); });
    expect(canAutoUpdate('a', 'b', true, false, storage)).toBe(false);
  });

  it('checks for edits again after asynchronous installation, before reloading', async () => {
    const reload = vi.fn(), safe = vi.fn(() => false);
    vi.stubGlobal('window', { location: { reload } });
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ version: 'b' })));
    await refreshApp(safe);
    expect(safe).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });
  it('returns a public version without permitting HTTP caching', async () => {
    const response = GET();
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(Object.keys(await response.json())).toEqual(['version']);
  });

  it('bypasses cached version responses and rejects invalid data', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ version: 'deployment-b' }))
      .mockResolvedValueOnce(Response.json({ version: null }));
    vi.stubGlobal('fetch', fetcher);
    expect(await fetchAppVersion()).toBe('deployment-b');
    expect(fetcher.mock.calls[0][0]).toMatch(/^\/api\/app-version\?t=\d+$/);
    expect(fetcher.mock.calls[0][1].cache).toBe('no-store');
    await expect(fetchAppVersion()).rejects.toThrow('Invalid version');
  });

  it('keeps the current page when the network is unavailable', async () => {
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    await expect(refreshApp()).rejects.toThrow('offline');
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads without service workers, without touching session storage', async () => {
    const reload = vi.fn();
    vi.stubGlobal('window', { location: { reload } });
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ version: 'deployment-b' })));
    await refreshApp();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('still reloads network-only HTML if worker update fails', async () => {
    const reload = vi.fn(), update = vi.fn().mockRejectedValue(new Error('worker unavailable'));
    vi.stubGlobal('window', { location: { reload } });
    vi.stubGlobal('navigator', { serviceWorker: { getRegistration: vi.fn().mockResolvedValue({ update }) } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ version: 'deployment-b' })));
    await refreshApp();
    expect(update).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });
});
