import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hooks = vi.hoisted(() => ({ effects: [] as Array<() => void | (() => void)> }));
const native = vi.hoisted(() => ({ addListener: vi.fn(), exitApp: vi.fn() }));
vi.mock("react", () => ({ useEffect: (effect: () => void | (() => void)) => hooks.effects.push(effect) }));
vi.mock("@capacitor/app", () => ({ App: native }));
import { CapacitorBackButton } from "@/components/layout/CapacitorBackButton";

let callback: (event: { canGoBack: boolean }) => void;
let cleanups: Array<() => void>;
let remove: ReturnType<typeof vi.fn>;
let back: ReturnType<typeof vi.fn>;
let dialogs: Array<{ getClientRects: () => unknown[]; dispatchEvent: ReturnType<typeof vi.fn> }>;

function mount() {
  CapacitorBackButton();
  const cleanup = hooks.effects.pop()!();
  if (cleanup) cleanups.push(cleanup);
  return cleanup;
}

beforeEach(() => {
  cleanups = [];
  dialogs = [];
  remove = vi.fn(async () => {});
  back = vi.fn();
  native.addListener.mockReset().mockImplementation(async (_name, listener) => {
    callback = listener;
    return { remove };
  });
  native.exitApp.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal("window", {
    Capacitor: { isNativePlatform: () => true, getPlatform: () => "android" },
    history: { back, length: 4 },
  });
  vi.stubGlobal("document", { querySelectorAll: () => dialogs });
  vi.stubGlobal("KeyboardEvent", class extends Event {
    key: string;
    constructor(type: string, init: KeyboardEventInit) {
      super(type, init);
      this.key = init.key ?? "";
    }
  });
});

afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  hooks.effects.length = 0;
  vi.unstubAllGlobals();
});

describe("CapacitorBackButton", () => {
  it("goes back when the native WebView has a previous entry", async () => {
    mount();
    await vi.waitFor(() => expect(native.addListener).toHaveBeenCalledWith("backButton", expect.any(Function)));
    callback({ canGoBack: true });
    expect(back).toHaveBeenCalledTimes(1);
    expect(native.exitApp).not.toHaveBeenCalled();
  });

  it("exits at the first page even when history.length includes forward entries", async () => {
    mount();
    await vi.waitFor(() => expect(native.addListener).toHaveBeenCalled());
    callback({ canGoBack: false });
    expect(native.exitApp).toHaveBeenCalledTimes(1);
    expect(back).not.toHaveBeenCalled();
  });

  it("sends bubbling Escape to the visible modal and leaves navigation untouched", async () => {
    const dialog = { getClientRects: () => [1], dispatchEvent: vi.fn() };
    dialogs.push(dialog, { getClientRects: () => [], dispatchEvent: vi.fn() });
    mount();
    await vi.waitFor(() => expect(native.addListener).toHaveBeenCalled());
    callback({ canGoBack: true });
    expect(dialog.dispatchEvent).toHaveBeenCalledWith(expect.objectContaining({ key: "Escape", bubbles: true, cancelable: true }));
    expect(back).not.toHaveBeenCalled();
    expect(native.exitApp).not.toHaveBeenCalled();
  });

  it.each(["ios", "web"])("does not install an Android-only listener on %s", async (platform) => {
    vi.stubGlobal("window", { Capacitor: { isNativePlatform: () => platform === "ios", getPlatform: () => platform } });
    expect(mount()).toBeUndefined();
    expect(native.addListener).not.toHaveBeenCalled();
  });

  it("ignores callbacks after unmount and removes the active listener", async () => {
    const cleanup = mount()!;
    await vi.waitFor(() => expect(native.addListener).toHaveBeenCalled());
    cleanup();
    cleanups = [];
    callback({ canGoBack: false });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(native.exitApp).not.toHaveBeenCalled();
  });

  it("does not attach if unmounted while importing the plugin", async () => {
    mount()!();
    cleanups = [];
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(native.addListener).not.toHaveBeenCalled();
  });

  it("removes a listener returned after unmount", async () => {
    let finish!: (value: { remove: typeof remove }) => void;
    native.addListener.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const cleanup = mount()!;
    await vi.waitFor(() => expect(native.addListener).toHaveBeenCalled());
    cleanup();
    cleanups = [];
    finish({ remove });
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
  });
});
