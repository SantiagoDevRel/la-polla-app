import { afterEach, describe, expect, it } from "vitest";
import {
  FACEBOOK_CALLBACK_PATH,
  facebookRedirectUrl,
  isFacebookLoginEnabled,
} from "./facebook-login";

const ORIGINAL = process.env.FACEBOOK_LOGIN_ENABLED;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.FACEBOOK_LOGIN_ENABLED;
  else process.env.FACEBOOK_LOGIN_ENABLED = ORIGINAL;
});

describe("interruptor de la entrada por Facebook", () => {
  it("apagado mientras la variable no diga exactamente true", () => {
    for (const value of ["", " ", "false", "0", "si", "enabled", "TRUE "]) {
      process.env.FACEBOOK_LOGIN_ENABLED = value;
      expect(isFacebookLoginEnabled()).toBe(value.trim().toLowerCase() === "true");
    }
  });

  it("apagado si la variable no existe: un proyecto sin el proveedor no ofrece el boton", () => {
    delete process.env.FACEBOOK_LOGIN_ENABLED;
    expect(isFacebookLoginEnabled()).toBe(false);
  });

  it("prendido con true, sin importar espacios ni mayusculas", () => {
    process.env.FACEBOOK_LOGIN_ENABLED = "  True  ";
    expect(isFacebookLoginEnabled()).toBe(true);
  });
});

describe("URL de vuelta", () => {
  it("cuelga el destino como next, codificado", () => {
    const url = new URL(
      facebookRedirectUrl("https://lapollacolombiana.com", "/polla/mundial-1?x=1"),
    );
    expect(url.pathname).toBe(FACEBOOK_CALLBACK_PATH);
    expect(url.searchParams.get("next")).toBe("/polla/mundial-1?x=1");
  });

  it("sin destino no inventa el parametro", () => {
    const url = new URL(facebookRedirectUrl("https://lapollacolombiana.com", null));
    expect(url.searchParams.has("next")).toBe(false);
  });

  it("respeta el origen del preview: cada despliegue vuelve al suyo", () => {
    expect(facebookRedirectUrl("https://la-polla-git-feat.vercel.app")).toBe(
      `https://la-polla-git-feat.vercel.app${FACEBOOK_CALLBACK_PATH}`,
    );
  });
});
