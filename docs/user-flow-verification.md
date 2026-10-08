# Registration, payment and prediction recovery

Login requests time out after 20 seconds and reject redirects or invalid JSON.
Synchronous locks prevent repeated submits. An uncertain code-send response lets
the player enter a code that may have arrived, with a resend cooldown. Verification
and password login reconcile a lost response against the authenticated profile;
the phone must match the submitted account before navigation. Invalid OTP attempts
never sign out an existing session. Persisted profile completeness decides onboarding.

The code-entry screen survives reload when session storage works. Registration still
works when storage is blocked; a reload in that mode cannot preserve the local draft.
Onboarding carries a sanitized destination in the URL as well as optional storage,
including a direct payment link. Pasted international phones keep one country prefix.

Optional PIN setup keeps an uncertain write's digits and request UUID in memory.
Migration `167_phone_password_write_revisions.sql` adds a credential revision fence
without replacing existing hashes. Exact retries are idempotent; stale writes and
account changes cannot overwrite another operation. Apply it before the app release;
see [password setup and rolling deployment](phone-password.md).

Receipt submissions preserve their request identity in memory when storage is blocked.
An expired session offers login in another tab while keeping the selected receipt and
request identity in the original screen for retry.
The cup selector is disabled while any proof is being sent. Leaving a successful payment
screen cancels its delayed navigation. A confirmed receipt and an approved payment remain
different states. Existing server reconciliation verifies immutable bytes and digest.
Responses that arrive after leaving the form cannot redirect or update its parent.
Standalone confirmation includes an explicit link to continue. The cup selector keeps
its dark background, readable value and keyboard operation across browser engines.

Score inputs allow full two-digit values. After a 300 ms typing pause, focus
advances from home to away and then to the next editable match; the last field
closes the keyboard. Enter advances immediately. Leaving or clearing a field
cancels its pending jump.
Touch and pen input preserve native focus and keyboard activation. Mouse-only
selection handling must not cancel touch pointer events; browser checks tap and
edit multiple matches in a shortened mobile viewport before one batch save.
Manual questions expose their prompt as an accessible label. Below 640 px, 1X2
options occupy full-width rows; larger screens use three equal columns. Team names stay readable with
enlarged text. Manual Save and revision fences remain.
Confirmed saves refresh the server summary without discarding newer local edits.
The invitation notice skips automatic opening while a draft or focused input needs attention.

Optional welcome downloads, splash storage and PWA registration failures cannot block
registration. Service-worker installation is explicitly caught; authenticated routes
retain their existing NetworkOnly policy. CI runs recovery checks against the built app.

Phone, PIN, receipt and prediction controls wait until their React handlers and any
saved draft are ready. Slow script downloads cannot silently discard early edits.
Match times use canonical spaces to avoid Node/WebKit locale hydration mismatches.

## Regressions

```sh
npm test -- tests/login-request.test.ts tests/verify-otp-reliability.test.ts tests/onboarding-return-flow.test.ts
npm test -- tests/casa-upload-client.test.ts tests/casa-proof-server.test.ts tests/casa-proof-image.test.ts
npm run test:e2e -- e2e/login-reliability.spec.ts e2e/login-hydration.spec.ts e2e/storage-unavailable.spec.ts e2e/welcome-network-failure.spec.ts e2e/traduccion.spec.ts e2e/app-update.spec.ts
npm run test:casa:browser
npm run test:casa:sql
```

With the matching WebKit binary already installed, run the same recovery tests with
`PLAYWRIGHT_BROWSER_ENGINE=webkit`. The default uses installed Chrome; WebKit selects
Safari desktop and iPhone viewport emulation. This does not test a physical device.

The browser suite uses real React and synthetic HTTP fault injection; the SQL runner
uses its own isolated container. Local end-to-end receipt checks additionally verify
Storage bytes, database confirmation, authenticated API responses and the rendered UI.
Never run synthetic payment approvals, proof uploads or prediction writes on production.
`scripts/casa-proof-browser-check.mjs` persists seven receipt regressions and refuses a
non-local origin or a server without an explicit local-only safety state. Run it with
`CASA_ORIGIN` and `CASA_LOCAL_SERVER_STATE` pointing to a guarded local server.

Inspect 320/768/1280 px, affected 639/640/641 px edges, and 200% text/zoom. Fault scenarios
include offline-before-send, response loss after a committed write, partial upload,
double submission, stale replies, session/account changes and blocked storage.
Real SMS delivery, transfers and physical Safari/iOS/Android require separate device
checks; browser emulation and passing regressions do not establish universal reliability.
