import type { PluginListenerHandle } from "@capacitor/core";

const APP_ORIGIN = "https://lapollacolombiana.com";
const LAUNCH_MARKER = "lp_native_launch_sha256";

/** Native intents are untrusted, including the path of an allowed HTTPS host. */
export function nativeLinkTarget(input: string): string | null {
  try {
    // Reject even empty userinfo (https://@host) and URL-parser repairs such
    // as an omitted //, escaped hostname or leading whitespace.
    if (!/^https:\/\/(?:www\.)?lapollacolombiana\.com(?::443)?(?=[/?#]|$)/i.test(input)) return null;
    const url = new URL(input);
    if (
      url.protocol !== "https:" ||
      !["lapollacolombiana.com", "www.lapollacolombiana.com"].includes(url.hostname) ||
      url.username || url.password || url.port
    ) return null;

    // Keep an absolute origin: a pathname beginning with // must never become
    // a protocol-relative navigation to another host. Preserve login tokens,
    // referral queries and Info hashes for their existing server/page handlers.
    return `${APP_ORIGIN}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

type NativeLinksApp = {
  addListener: (
    name: "appUrlOpen",
    listener: (event: { url: string }) => void,
  ) => Promise<PluginListenerHandle>;
  getLaunchUrl: () => Promise<{ url: string } | undefined>;
};

type NativeLinksEnvironment = {
  currentUrl: () => string;
  navigate: (target: string) => void;
  // Access lazily: even reading window.sessionStorage can throw.
  storage: () => Pick<Storage, "getItem" | "setItem">;
};

/** Register first so a warm intent cannot get lost while reading the cold one. */
export function listenForNativeLinks(app: NativeLinksApp, environment: NativeLinksEnvironment): () => void {
  let disposed = false;
  let initialized = false;
  let navigating = false;
  let pendingTarget: string | null = null;
  let handle: PluginListenerHandle | undefined;

  const remove = (listener: PluginListenerHandle) => { void listener.remove().catch(() => {}); };
  const navigate = (target: string) => {
    const current = nativeLinkTarget(environment.currentUrl());
    if (disposed || navigating || target === current) return;
    // Fragment changes keep this document (and listener) alive. Only suppress
    // subsequent intents when a different document is actually being loaded.
    navigating = target.split("#", 1)[0] !== current?.split("#", 1)[0];
    environment.navigate(target);
  };

  void (async () => {
    const listener = await app.addListener("appUrlOpen", ({ url }) => {
      if (disposed) return;
      const target = nativeLinkTarget(url);
      if (!target) return;
      if (!initialized) pendingTarget = target;
      else navigate(target);
    });
    if (disposed) { remove(listener); return; }
    handle = listener;

    const launch = await app.getLaunchUrl().catch(() => undefined);
    if (disposed) return;
    const launchTarget = launch ? nativeLinkTarget(launch.url) : null;
    let openLaunch = false;
    if (launchTarget) {
      try {
        // Capacitor keeps its original launch intent after a hard navigation.
        // Persist consumption BEFORE navigating, without persisting its token.
        // Warm intents never replace this marker: getLaunchUrl stays original.
        const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(launchTarget));
        if (disposed) return;
        const fingerprint = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
        const storage = environment.storage();
        const previous = storage.getItem(LAUNCH_MARKER);
        storage.setItem(LAUNCH_MARKER, fingerprint);
        openLaunch = previous !== fingerprint;
      } catch {
        // Without persistent consumption a cold auth redirect could loop forever.
        // Live appUrlOpen events still work when storage/crypto is unavailable.
      }
    }

    if (disposed) return;
    initialized = true;
    if (pendingTarget) navigate(pendingTarget);
    else if (openLaunch && launchTarget) navigate(launchTarget);
  })().catch(() => { /* Native plugin unavailable: keep the existing page. */ });

  return () => {
    disposed = true;
    if (handle) remove(handle);
  };
}
