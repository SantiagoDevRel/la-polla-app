# Urgent and high-priority fixes

These fixes apply to the current application, not the older audit branch.
Historical P2P predictions and production rollout settings are preserved.

| Finding | Behavior | Regression |
|---|---|---|
| Secret hook | Scan staged blobs from the selected index; block missing/failed scanners | `test:secrets` |
| Invite preview | Token and slug must identify the same pool; public preview omits private fields; no-store | `tests/polla-preview.test.ts` |
| Draft saves | A response acknowledges only its submitted revision | `test:casa:browser` |
| Unknown kickoff | Playable until evidence of play; confirmed times retain the five-minute lock | Timing SQL, match rules, calendar, browser |
| Terminal balance | Both pot modes account for retained gross or actual payouts | Balance SQL |
| Gift enrollment | `Entrar gratis` immediately enrolls; retries reuse the entry; old pending reservations complete without proof | Free SQL/API/browser |
| Delivery checks | Types, lint, Vitest, build, hook, SQL/RLS, and browser feed `Quality gate` | `.github/workflows/quality.yml` |
| Agent instructions | One current contract; auth incident marked resolved; legacy access filters retained | `AGENTS.md` + `docs/agent-rules.md`, two-user RLS regression |

## Local checks

```sh
npm run validate
npm test
npm run build
npm run test:secrets
npm run test:casa:sql
npm run test:casa:browser
```

Set `TRUFFLEHOG_PATH` to an installed TruffleHog binary. The hook test generates a
disposable RSA key, never uses real credentials, and verifies the selected index.
`test:casa:sql` creates its own network-isolated PostgreSQL container, replays the
migration chain with the existing local platform stand-ins, runs rollback fixtures,
and removes only that container. It never connects to an existing/local/remote DB.
The platform stand-ins do not test OTP delivery, Storage, or real cron workers.
Browser checks use real React boards and synthetic requests in isolated Chrome.
Windows screenshot baselines stay separate from Linux accessibility checks.

## Database changes

Apply migrations 161–163 before deploying their UI:

- 161 preserves existing authoring/creation/editor authorization and SQL privileges.
  Provisional midnight is not a deadline. Auto closure uses confirmed matches; an
  administrator supplies a fallback if all times are unknown. Calendar updates replace
  that fallback when appropriate. Precision-only updates also trigger recomputation.
  Pools already closed do not automatically reopen. No existing pool/pick is rewritten.
- 162 changes only the summary function. Zero-points outcomes and voids account for
  collected gross in both pot modes. Prize formulas and settlement rules are unchanged.
- 163 completes an existing pending entry only when its owner explicitly joins a free
  pool. It preserves identity and proof history; paid pools retain their review flow.

Before applying, compare the current function definitions and privileges with the
versioned baseline. The editor patch aborts if its expected definition does not match.
Check security advisors and verify functions remain service-role-only afterward.
Do not enable rollout flags or rewrite historical data to install these changes.

## CI enforcement

Branch protection on `main` requires the aggregate **Quality gate** check (strict,
admins included; verified 2026-10-08). A workflow without a required branch check
does not prevent merging failed checks, so re-verify protection after changing CI.
There is no production secret in CI; it uses only loopback URLs and synthetic keys.

The current welcome screen intentionally shows nine featured leagues in three rows.
The full supported competition catalog is tested independently. Do not expand the
welcome grid merely because another league is supported.
