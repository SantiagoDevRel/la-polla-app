# Optional six-digit phone password

Registration offers a six-digit password after the user completes their profile. SMS and WhatsApp remain available. Profile links to `/set-password?returnTo=%2Fperfil` to create or change the password without requiring the previous password.

Forgot-password recovery offers WhatsApp first and SMS as an alternative. WhatsApp uses the existing access link; the user can then change their password in Profile. The recovery SMS flow opens `/set-password` after verifying the phone. Ordinary SMS login does not open password setup.

Profile places the password action below the payout account while the channel is enabled. An existing credential shows a green check and a change action; an absent credential shows a create action. Setup also distinguishes creating and changing. Show/Hide controls expose only the currently entered values, including confirmation and login; they never recover the stored password. Values remain in memory until saving or leaving.

Typography reuses existing role tokens: Profile uses Outfit 16/600 for headings, 14/600 for status and controls, and 14/400 with 1.625 line height for help. Login uses Bebas 24/400 for headings, Outfit 14 for help and labels, and 16 for inputs and the primary action. Essential controls wrap and remain usable at 200% text size.

Enable the channel with server-only `PHONE_PASSWORD_ENABLED=true` and a random `AUTH_PIN_PEPPER` of at least 32 characters. Apply migrations `160_optional_phone_password.sql` and `167_phone_password_write_revisions.sql` before deploying the corresponding application code. Changing the pepper invalidates existing passwords; preserve it during ordinary deployments.

Credentials use scrypt (N=32768, r=8, p=1) and an independent pepper. New setup writes derive a 16-byte salt from a server-keyed HMAC of the authenticated owner and request UUID. This salt is stable only for retries of that operation, allowing an exact replay without storing the plaintext password. Different owners and operations have distinct salts. Previously stored random salts and hashes remain valid.

`phone_password_credentials` has deny-all RLS and service-role-only access. Password login does not create a public GoTrue password: that would bypass the dedicated six-digit-password attempt limits. It reuses the verified-phone session flow and checks that the resulting user owns the credential. Invalid OTP attempts preserve the current session.

## Saving and retrying

The authenticated status endpoint returns channel availability, credential presence for the current verified phone, owner UUID and credential revision. It filters by the authenticated UUID, enumerates columns and uses `private, no-store`. Errors remain retryable and never imply that a password is absent.

The setup POST includes `expected_user_id`, `request_id` and `expected_revision`. The route checks the session and same-origin proof before calling service-only `phone_password_save_v1`. The transaction locks the owner, rechecks the verified phone, rejects stale revisions and deduplicates exact request replays. Reusing a request UUID with a different payload is rejected. Contention has a two-second lock deadline.

A request timeout can occur after commit. The form retains its digits in memory, freezes editing and retries the same operation. An exact acknowledgement must match the owner, request UUID and next revision before navigating. A stale-operation conflict requires a fresh authenticated status read before another deliberate save. Session changes and old open forms require refreshing the page. Passwords are never written to browser storage or logs.

Migration 167 appends metadata without replacing credentials. During a rolling deployment, old unfenced writes remain allowed only until that owner receives their first fenced write. Every old write increments the revision, invalidating stale new requests. After the first fenced write, late unfenced writes are rejected. This compatibility window does not allow an old request to overwrite a credential protected by the new protocol.

## Validation

Run `npm test -- tests/phone-password.test.ts tests/profile-password.test.ts tests/phone-session-reliability.test.ts` and `node scripts/check-casa-sql.mjs`. The latter replays every migration in a fresh network-isolated PostgreSQL container and checks idempotence, stale writes, verified-phone ownership, rolling deployment compatibility and real concurrent transactions. It never connects to an existing database.

Existing attempt-limit regressions remain available in `scripts/phone-password-check.sql` (transaction with rollback) and `node scripts/phone-password-concurrency-check.mjs` (local PostgreSQL only). These complement the new credential-write checks and do not send provider messages.

Login attempt reservations remain separate from SMS: five per phone in 15 minutes, 20 per phone in 24 hours and 50 per IP in 15 minutes. IPs are stored as HMACs. Provider messages are mocked in browser regressions; local fixture accounts exercise the actual database and session chain without sending SMS or email.
