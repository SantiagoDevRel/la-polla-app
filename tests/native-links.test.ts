import { describe, expect, it, vi } from "vitest";
import { listenForNativeLinks, nativeLinkTarget } from "@/lib/platform/native-links";

const ORIGIN = "https://lapollacolombiana.com";
const LOGIN = `${ORIGIN}/login/telegram?t=one-use-test-token#confirmar`;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function fixture(launch?: string, values = new Map<string, string>()) {
  let emit: (event: { url: string }) => void = () => {};
  const remove = vi.fn(async () => {});
  const app = {
    addListener: vi.fn(async (_event: "appUrlOpen", callback: (event: { url: string }) => void) => {
      emit = callback;
      return { remove };
    }),
    getLaunchUrl: vi.fn(async (): Promise<{ url: string } | undefined> => launch ? { url: launch } : undefined),
  };
  const storage = {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
  };
  const environment = {
    currentUrl: vi.fn(() => `${ORIGIN}/casa`),
    navigate: vi.fn(),
    storage: () => storage,
  };
  return { app, environment, storage, values, remove, emit: (url: string) => emit({ url }) };
}

describe("nativeLinkTarget", () => {
  it.each([
    [LOGIN, LOGIN],
    [`https://www.lapollacolombiana.com/polla/pollagol?ref=ABC%2B123#info-premio`, `${ORIGIN}/polla/pollagol?ref=ABC%2B123#info-premio`],
    [`https://lapollacolombiana.com:443/casa`, `${ORIGIN}/casa`],
    [`${ORIGIN}//evil.example/phishing`, `${ORIGIN}//evil.example/phishing`],
  ])("canonicalizes %s without dropping query or hash", (input, expected) => {
    expect(nativeLinkTarget(input)).toBe(expected);
    expect(new URL(nativeLinkTarget(input)!).origin).toBe(ORIGIN);
  });

  it.each([
    "http://lapollacolombiana.com/casa",
    "javascript:alert(1)",
    "intent://lapollacolombiana.com/casa",
    "capacitor://localhost/casa",
    "https://chickenpicks.app/casa",
    "https://evil.example/casa",
    "https://lapollacolombiana.com.evil.example/casa",
    "https://evil.example@lapollacolombiana.com/casa",
    "https://user:password@lapollacolombiana.com/casa",
    "https://@lapollacolombiana.com/casa",
    "https://:@lapollacolombiana.com/casa",
    "https://lapollacolombiana.com@evil.example/casa",
    "https://lapollacolombiana.com:8443/casa",
    "https://lapollacolombiana.com./casa",
    "https:lapollacolombiana.com/casa",
    "https://%6capollacolombiana.com/casa",
    " https://lapollacolombiana.com/casa",
    "//lapollacolombiana.com/casa",
    "/polla/pollagol",
    "",
  ])("rejects untrusted intent %s", (input) => {
    expect(nativeLinkTarget(input)).toBeNull();
  });
});

describe("native intent lifecycle", () => {
  it("opens a cold Telegram link once, persists no token, and does not replay after its POST redirect", async () => {
    const first = fixture(LOGIN);
    const stop = listenForNativeLinks(first.app, first.environment);
    await vi.waitFor(() => expect(first.environment.navigate).toHaveBeenCalledWith(LOGIN));
    expect(first.app.addListener.mock.invocationCallOrder[0]).toBeLessThan(first.app.getLaunchUrl.mock.invocationCallOrder[0]);
    const marker = [...first.values.values()][0];
    expect(marker).toMatch(/^[a-f0-9]{64}$/);
    expect(marker).not.toContain("one-use-test-token");
    expect(first.storage.setItem.mock.invocationCallOrder[0]).toBeLessThan(first.environment.navigate.mock.invocationCallOrder[0]);
    stop();

    // A new document after the login POST still gets the original native intent.
    const redirected = fixture(LOGIN, first.values);
    const stopRedirected = listenForNativeLinks(redirected.app, redirected.environment);
    await vi.waitFor(() => expect(redirected.storage.getItem).toHaveBeenCalled());
    expect(redirected.environment.navigate).not.toHaveBeenCalled();
    stopRedirected();
  });

  it("opens a warm link and keeps the original launch consumed on the next document", async () => {
    const current = fixture(`${ORIGIN}/casa`);
    const stop = listenForNativeLinks(current.app, current.environment);
    await vi.waitFor(() => expect(current.storage.setItem).toHaveBeenCalled());
    expect(current.environment.navigate).not.toHaveBeenCalled();
    current.emit(LOGIN);
    current.emit(LOGIN);
    expect(current.environment.navigate).toHaveBeenCalledExactlyOnceWith(LOGIN);
    stop();

    const next = fixture(`${ORIGIN}/casa`, current.values);
    next.environment.currentUrl.mockReturnValue(`${ORIGIN}/perfil`);
    const stopNext = listenForNativeLinks(next.app, next.environment);
    await vi.waitFor(() => expect(next.storage.getItem).toHaveBeenCalled());
    expect(next.environment.navigate).not.toHaveBeenCalled();
    stopNext();
  });

  it("prefers a warm event received while reading a stale cold intent", async () => {
    const current = fixture();
    const launch = deferred<{ url: string }>();
    current.app.getLaunchUrl.mockReturnValue(launch.promise);
    const stop = listenForNativeLinks(current.app, current.environment);
    await vi.waitFor(() => expect(current.app.getLaunchUrl).toHaveBeenCalled());
    current.emit(LOGIN);
    launch.resolve({ url: `${ORIGIN}/polla/old-link` });
    await vi.waitFor(() => expect(current.environment.navigate).toHaveBeenCalledExactlyOnceWith(LOGIN));
    stop();
  });

  it.each(["cold", "warm"])("keeps listening after a %s link only changes the current page hash", async (kind) => {
    const section = `${ORIGIN}/casa#informacion`;
    const profile = `${ORIGIN}/perfil`;
    const current = fixture(kind === "cold" ? section : `${ORIGIN}/casa`);
    // A hash assignment updates location immediately without remounting React.
    current.environment.navigate.mockImplementation((target: string) => {
      if (target === section) current.environment.currentUrl.mockReturnValue(target);
    });
    const stop = listenForNativeLinks(current.app, current.environment);
    await vi.waitFor(() => expect(current.storage.setItem).toHaveBeenCalled());
    if (kind === "warm") current.emit(section);
    expect(current.environment.navigate).toHaveBeenCalledExactlyOnceWith(section);
    current.emit(profile);
    expect(current.environment.navigate).toHaveBeenNthCalledWith(2, profile);
    // Full-document navigation still suppresses repeated intents while loading.
    current.emit(profile);
    expect(current.environment.navigate).toHaveBeenCalledTimes(2);
    stop();
  });

  it("deduplicates the same cold URL and initial appUrlOpen event", async () => {
    const current = fixture(LOGIN);
    const stop = listenForNativeLinks(current.app, current.environment);
    current.emit(LOGIN);
    await vi.waitFor(() => expect(current.environment.navigate).toHaveBeenCalledExactlyOnceWith(LOGIN));
    current.emit(LOGIN);
    expect(current.environment.navigate).toHaveBeenCalledTimes(1);
    stop();
  });

  it("ignores invalid warm events without suppressing the valid cold intent", async () => {
    const current = fixture(LOGIN);
    const stop = listenForNativeLinks(current.app, current.environment);
    current.emit("https://evil.example/login");
    await vi.waitFor(() => expect(current.environment.navigate).toHaveBeenCalledExactlyOnceWith(LOGIN));
    stop();
  });

  it("keeps warm links working if reading the initial intent fails", async () => {
    const current = fixture();
    current.app.getLaunchUrl.mockRejectedValue(new Error("unavailable"));
    const stop = listenForNativeLinks(current.app, current.environment);
    await vi.waitFor(() => expect(current.app.getLaunchUrl).toHaveBeenCalled());
    current.emit(LOGIN);
    await vi.waitFor(() => expect(current.environment.navigate).toHaveBeenCalledExactlyOnceWith(LOGIN));
    stop();
  });

  it("avoids a cold reload loop when sessionStorage is inaccessible, while accepting warm links", async () => {
    const current = fixture(LOGIN);
    const deniedStorage = vi.fn(() => { throw new Error("storage denied"); });
    const stop = listenForNativeLinks(current.app, { ...current.environment, storage: deniedStorage });
    await vi.waitFor(() => expect(deniedStorage).toHaveBeenCalled());
    expect(current.environment.navigate).not.toHaveBeenCalled();
    current.emit(LOGIN);
    expect(current.environment.navigate).toHaveBeenCalledExactlyOnceWith(LOGIN);
    stop();
  });

  it("removes a listener whose registration resolves after cleanup", async () => {
    const current = fixture(LOGIN);
    const listener = deferred<{ remove: typeof current.remove }>();
    current.app.addListener.mockReturnValue(listener.promise);
    const stop = listenForNativeLinks(current.app, current.environment);
    stop();
    listener.resolve({ remove: current.remove });
    await vi.waitFor(() => expect(current.remove).toHaveBeenCalledTimes(1));
    expect(current.app.getLaunchUrl).not.toHaveBeenCalled();
    expect(current.environment.navigate).not.toHaveBeenCalled();
  });

  it("does not consume or navigate an intent resolved after cleanup (StrictMode remount)", async () => {
    const current = fixture();
    const launch = deferred<{ url: string }>();
    current.app.getLaunchUrl.mockReturnValue(launch.promise);
    const stop = listenForNativeLinks(current.app, current.environment);
    await vi.waitFor(() => expect(current.app.getLaunchUrl).toHaveBeenCalled());
    stop();
    current.emit(LOGIN);
    launch.resolve({ url: LOGIN });
    await launch.promise;
    expect(current.remove).toHaveBeenCalledTimes(1);
    expect(current.storage.setItem).not.toHaveBeenCalled();
    expect(current.environment.navigate).not.toHaveBeenCalled();

    const mounted = fixture(LOGIN, current.values);
    const stopMounted = listenForNativeLinks(mounted.app, mounted.environment);
    await vi.waitFor(() => expect(mounted.environment.navigate).toHaveBeenCalledExactlyOnceWith(LOGIN));
    stopMounted();
  });
});
