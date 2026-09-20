import { describe, it, expect } from "vitest";
import {
  isInAppBrowser,
  isIOSDevice,
  resolveInstallMode,
  type InstallEnvironment,
} from "./install-mode";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1";
const IPAD =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 13; SM-A135M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const INSTAGRAM_ANDROID = `${ANDROID} Instagram 300.0.0.0.0 Android`;
const FACEBOOK_IOS = `${IPHONE} [FBAN/FBIOS;FBAV/450.0.0.0]`;

function env(over: Partial<InstallEnvironment> = {}): InstallEnvironment {
  return {
    userAgent: ANDROID,
    standalone: false,
    nativeShell: false,
    maxTouchPoints: 5,
    hasInstallPrompt: false,
    ...over,
  };
}

describe("isIOSDevice", () => {
  it("iPhone", () => expect(isIOSDevice(IPHONE, 5)).toBe(true));

  it("iPad se presenta como Mac: lo delata el touch", () => {
    expect(isIOSDevice(IPAD, 5)).toBe(true);
    expect(isIOSDevice(MAC, 0)).toBe(false);
  });

  it("Android no es iOS", () => expect(isIOSDevice(ANDROID, 5)).toBe(false));
});

describe("isInAppBrowser", () => {
  it("navegador embebido de una red social", () => {
    expect(isInAppBrowser(INSTAGRAM_ANDROID)).toBe(true);
    expect(isInAppBrowser(FACEBOOK_IOS)).toBe(true);
  });

  it("Safari y Chrome de verdad no lo son", () => {
    expect(isInAppBrowser(IPHONE)).toBe(false);
    expect(isInAppBrowser(ANDROID)).toBe(false);
  });
});

describe("resolveInstallMode", () => {
  it("ya instalada (standalone) → no se ofrece nada", () => {
    expect(resolveInstallMode(env({ standalone: true }))).toBe("hidden");
    // Y tampoco si encima Chrome insistiera con el evento.
    expect(
      resolveInstallMode(env({ standalone: true, hasInstallPrompt: true })),
    ).toBe("hidden");
  });

  it("dentro del wrapper Capacitor → no se ofrece nada", () => {
    expect(resolveInstallMode(env({ nativeShell: true }))).toBe("hidden");
    expect(
      resolveInstallMode(env({ nativeShell: true, hasInstallPrompt: true })),
    ).toBe("hidden");
  });

  it("Chrome dio el evento → un toque, sin tutorial", () => {
    expect(resolveInstallMode(env({ hasInstallPrompt: true }))).toBe("prompt");
    // Tambien en escritorio: el evento manda sobre el sistema operativo.
    expect(
      resolveInstallMode(
        env({ userAgent: MAC, maxTouchPoints: 0, hasInstallPrompt: true }),
      ),
    ).toBe("prompt");
    // Y en un iPhone hipotetico que algun dia lo emitiera, mandaria el evento.
    expect(
      resolveInstallMode(env({ userAgent: IPHONE, hasInstallPrompt: true })),
    ).toBe("prompt");
  });

  it("iPhone y iPad → los pasos de Safari (Apple no expone el evento)", () => {
    expect(resolveInstallMode(env({ userAgent: IPHONE }))).toBe("ios");
    expect(resolveInstallMode(env({ userAgent: IPAD }))).toBe("ios");
  });

  it("Android sin evento → nada, ni un tutorial", () => {
    // Decision del dueno (2026-09-20): en Android o se instala de un toque, o
    // no se ofrece. El caso tipico es el navegador interno de WhatsApp, que no
    // puede instalar nada; un boton ahi seria un boton que no cumple.
    expect(resolveInstallMode(env())).toBe("hidden");
    expect(resolveInstallMode(env({ userAgent: INSTAGRAM_ANDROID }))).toBe(
      "hidden",
    );
  });

  it("escritorio sin evento → nada", () => {
    expect(resolveInstallMode(env({ userAgent: MAC, maxTouchPoints: 0 }))).toBe(
      "hidden",
    );
  });
});
