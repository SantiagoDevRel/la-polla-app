// Run ONLY against an isolated Android emulator with an installed debuggable APK.
// This deliberately backgrounds and force-stops La Polla twice. Never use a
// person's phone or another session's emulator. No login, SMS, database writes,
// CDP cookie injection, or changes to existing cookies are performed.
// Usage: node scripts/android-session-check.mjs --serial emulator-5572 [--adb /path/to/adb]
// A fictitious ten-minute cookie arrives through HTTP Set-Cookie, survives an
// app restart, then is deleted through HTTP and must stay deleted after restart.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { _android } from "playwright";

const PACKAGE = "com.lapollacolombiana.app";
const ORIGIN = "https://lapollacolombiana.com";
const run = promisify(execFile);

function argumentsForProbe(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    assert(["--serial", "--adb"].includes(key) && args[index + 1], "Use --serial emulator-<number> [--adb /path/to/adb].");
    assert(!options[key], `Repeated argument: ${key}`);
    options[key] = args[index + 1];
  }
  assert(/^emulator-\d+$/.test(options["--serial"] ?? ""), "An explicit isolated --serial emulator-<number> is required.");
  const sdk = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME
    || (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Android", "Sdk") : "");
  const sdkAdb = sdk && join(sdk, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
  return { serial: options["--serial"], adbPath: options["--adb"] || (sdkAdb && existsSync(sdkAdb) ? sdkAdb : "adb") };
}

async function checkSessionPersistence() {
  const { serial, adbPath } = argumentsForProbe(process.argv.slice(2));
  const adb = async (...args) => (await run(adbPath, ["-s", serial, ...args], {
    windowsHide: true, timeout: 30_000, maxBuffer: 1024 * 1024,
  })).stdout.trim();
  assert.equal(await adb("get-state"), "device", "Selected emulator is not ready.");
  assert.equal(await adb("shell", "getprop", "ro.kernel.qemu"), "1", "The selected target must be an emulator.");
  // run-as fails for production/non-debuggable APKs. It only reads this app's UID.
  await adb("shell", "run-as", PACKAGE, "id");

  const suffix = randomUUID().replaceAll("-", "");
  const cookieName = `lp_session_probe_${suffix}`;
  const cookieValue = randomUUID();
  const probeUrl = `${ORIGIN}/api/android-session-probe-${suffix}`;
  const probePattern = `**/api/android-session-probe-${suffix}`;
  const report = { serial, package: PACKAGE, cookie: cookieName, beforeRestart: null, afterRestart: null, deletionSurvivesRestart: false };
  let device;
  let page;
  let cdp;
  let markerMayExist = false;
  let initialUrl;

  async function attach() {
    page = await (await device.webView({ pkg: PACKAGE, timeout: 30_000 })).page();
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(60_000);
    await page.waitForFunction((origin) => location.origin === origin, ORIGIN);
    cdp = await page.context().newCDPSession(page);
  }

  async function readProbe() {
    const { cookies } = await cdp.send("Network.getCookies", { urls: [ORIGIN] });
    return cookies.find((cookie) => cookie.name === cookieName);
  }

  function metadata(cookie) {
    return {
      name: cookie.name, expires: cookie.expires, session: cookie.session,
      secure: cookie.secure, sameSite: cookie.sameSite, path: cookie.path,
    };
  }

  async function setProbeThroughHttp(remove) {
    let intercepted = false;
    const handler = async (route) => {
      assert.equal(route.request().method(), "POST");
      intercepted = true;
      await route.fulfill({
        status: 200,
        headers: {
          "Content-Type": "application/json", "Cache-Control": "no-store",
          "Set-Cookie": `${cookieName}=${remove ? "" : cookieValue}; Max-Age=${remove ? 0 : 600}; Path=/; Secure; SameSite=Lax`,
        },
        body: JSON.stringify({ ok: true }),
      });
    };
    // Only this new endpoint is intercepted. Existing auth cookies/routes stay intact.
    await cdp.send("Network.setBypassServiceWorker", { bypass: true });
    await page.route(probePattern, handler);
    try {
      const result = await page.evaluate(async (url) => {
        // POST avoids Capacitor's separate proxy for remote HTML GET responses.
        const response = await fetch(url, {
          method: "POST", credentials: "same-origin", cache: "no-store",
          headers: { "Content-Type": "application/json", Accept: "application/json" }, body: "{}",
        });
        const json = (response.headers.get("content-type") ?? "").includes("application/json");
        return { status: response.status, body: json ? await response.json() : null };
      }, probeUrl);
      assert(intercepted, "The probe must be fulfilled locally, never by the remote server.");
      assert.equal(result.status, 200);
      assert.equal(result.body?.ok, true);
    } finally {
      await page.unroute(probePattern, handler);
      await cdp.send("Network.setBypassServiceWorker", { bypass: false });
    }
  }

  async function restart() {
    await cdp.detach();
    await adb("shell", "input", "keyevent", "KEYCODE_HOME");
    await delay(1_000);
    await adb("shell", "am", "force-stop", PACKAGE);
    // Let Playwright observe removal of the old WebView before attaching again.
    await delay(750);
    await adb("shell", "am", "start", "-n", `${PACKAGE}/.MainActivity`);
    await attach();
  }

  try {
    device = (await _android.devices({ omitDriverInstall: true })).find((candidate) => candidate.serial() === serial);
    assert(device, "Selected emulator is not visible to Playwright.");
    // Only the explicitly selected app is launched or attached to.
    await adb("shell", "am", "start", "-n", `${PACKAGE}/.MainActivity`);
    await attach();
    initialUrl = page.url();

    markerMayExist = true;
    await setProbeThroughHttp(false);
    const before = await readProbe();
    assert(before, "HTTP Set-Cookie did not create the probe cookie.");
    assert.equal(before.value, cookieValue, "Probe cookie contents differ.");
    assert.equal(before.session, false, "Probe was stored as a session-only cookie.");
    assert(before.expires > Date.now() / 1000 + 500, "Probe must retain its ten-minute expiry.");
    assert(before.secure && before.sameSite === "Lax" && before.path === "/", "Probe attributes changed.");
    report.beforeRestart = metadata(before);

    await restart();
    const after = await readProbe();
    assert(after, "Persistent HTTP cookie disappeared after background + process restart.");
    assert.equal(after.value, cookieValue, "Probe cookie contents changed after restart.");
    assert.equal(after.expires, before.expires, "Restart changed the cookie expiry.");
    assert.equal(after.session, false);
    report.afterRestart = metadata(after);

    await setProbeThroughHttp(true);
    assert.equal(await readProbe(), undefined, "HTTP deletion did not remove the probe.");
    await restart();
    assert.equal(await readProbe(), undefined, "Deleted cookie returned after restart.");
    markerMayExist = false;
    report.deletionSurvivesRestart = true;
    // Restore only ordinary navigation, never replay a query containing a login token.
    const initial = new URL(initialUrl);
    if (!initial.search && !initial.hash && page.url() !== initialUrl) await page.goto(initialUrl);
    return { ok: true, ...report };
  } finally {
    // Cleanup can expire only this run's random marker, never an existing cookie.
    if (markerMayExist && page && !page.isClosed() && cdp) {
      await setProbeThroughHttp(true).catch(() => {});
    }
    await cdp?.detach().catch(() => {});
    await device?.close().catch(() => {});
  }
}

try {
  console.log(JSON.stringify(await checkSessionPersistence(), null, 2));
  // _android.devices() also enumerates other devices; stop its metadata polling.
  // No browser/device belonging to another session is closed or operated on.
  process.exit(0);
} catch (error) {
  // Do not dump Playwright call logs or response bodies, which can include URLs.
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message.split("\n")[0] : "Probe failed" }));
  process.exit(1);
}
