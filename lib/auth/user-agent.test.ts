import { describe, it, expect } from "vitest";
import { parseDeviceLabel } from "./user-agent";

describe("parseDeviceLabel", () => {
  it("recognizes iPhone Safari", () => {
    expect(
      parseDeviceLabel(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
      ),
    ).toBe("iPhone");
  });

  it("recognizes Android mobile", () => {
    expect(
      parseDeviceLabel(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
      ),
    ).toBe("Android");
  });

  it("recognizes Android tablet (no 'mobile' token)", () => {
    expect(
      parseDeviceLabel(
        "Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      ),
    ).toBe("Android tablet");
  });

  it("recognizes Mac", () => {
    expect(
      parseDeviceLabel(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 Version/17.4 Safari/605.1.15",
      ),
    ).toBe("Mac");
  });

  it("recognizes Windows", () => {
    expect(
      parseDeviceLabel(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      ),
    ).toBe("Windows");
  });

  it("falls back to a generic label for unknown UAs", () => {
    expect(parseDeviceLabel("curl/8.0")).toBe("otro dispositivo");
  });

  it("handles missing user agent", () => {
    expect(parseDeviceLabel(null)).toBe("dispositivo desconocido");
    expect(parseDeviceLabel(undefined)).toBe("dispositivo desconocido");
  });
});
