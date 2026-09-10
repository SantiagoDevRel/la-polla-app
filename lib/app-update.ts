// Public build identity, frozen into both the client and version endpoint.
export const APP_BUILD_ID = process.env.NEXT_PUBLIC_APP_BUILD_ID ?? 'development';

export async function fetchAppVersion(): Promise<string> {
  const response = await fetch(`/api/app-version?t=${Date.now()}`, {
    cache: 'no-store', signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('Version unavailable');
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('version' in data) || typeof data.version !== 'string' || !data.version) {
    throw new Error('Invalid version');
  }
  return data.version;
}

export async function refreshApp(): Promise<void> {
  // Verify connectivity first; never replace a usable screen with an offline error.
  await fetchAppVersion();
  if (navigator.serviceWorker) {
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        await Promise.race([registration.update(), new Promise(resolve => setTimeout(resolve, 4000))]);
        const worker = registration.waiting ?? registration.installing;
        if (worker && worker.state !== 'activated') {
          await new Promise<void>(resolve => {
            const done = () => { clearTimeout(timer); worker.removeEventListener('statechange', changed); resolve(); };
            const changed = () => {
              if (worker.state === 'installed') worker.postMessage({ type: 'SKIP_WAITING' });
              if (worker.state === 'activated' || worker.state === 'redundant') done();
            };
            const timer = setTimeout(done, 5000);
            worker.addEventListener('statechange', changed);
            worker.postMessage({ type: 'SKIP_WAITING' });
            changed();
          });
        }
      }
    } catch { /* Authenticated HTML is NetworkOnly even if SW update fails. */ }
  }
  window.location.reload();
}
