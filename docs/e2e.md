# E2E Testing (Maestro)

E2E tests run on a booted iOS simulator (or Android emulator) using
[Maestro](https://maestro.mobile.dev).

## Quick start

```bash
# 1. Start infrastructure + backend
mise run stack:up
mise run dev:backend      # in a separate terminal

# 2. Build & install the app on the simulator (one-time)
mise run maestro:install

# 3. Run the tests
mise run maestro:smoke    # works without backend
mise run maestro:auth     # needs backend + tinyauth
mise run maestro:test     # all flows
```

## Maestro flows

| Flow | Purpose | Backend required? |
|------|---------|-------------------|
| `smoke.yaml` | App launch, login screen renders | No |
| `auth.yaml` | Login with interviewer1/pass1 | Yes |
| `create-recording.yaml` | Record 5s, fill metadata, save | Yes |
| `view-and-signout.yaml` | Open recordings list, sign out | Yes |
| `accept-mic-permission.yaml` | Helper for iOS mic dialog | — |

## EAS CI

The `.eas/workflows/e2e-test-android.yml` workflow runs the smoke test on every
pull request (builds a `.apk` via the `e2e-test` profile, runs Maestro on EAS
servers).

Run manually:

```bash
mise run e2e:android
```

## TODOs

### Maestro configuration

- [ ] **`testID` selectors.** Add `testID` props to key UI elements (login
      fields, recording controls, list rows, playback buttons) so Maestro
      selectors are robust against text changes. Currently all flows use
      `text:` matchers which can break on copy changes.
- [ ] **iOS EAS workflow.** Add `.eas/workflows/e2e-test-ios.yml` (currently
      only Android is wired).
- [ ] **Mock API for CI.** The full recording flows need the backend +
      Tinyauth running. For EAS CI, either deploy a staging backend or add a
      network-mocking layer (e.g., Mock Service Worker or a local API stub)
      so `create-recording.yaml` can run in CI without live infrastructure.
- [ ] **Seeded data.** Pre-seed the simulator with at least one recording
      so the `view-and-signout.yaml` flow can actually navigate into a
      non-empty recordings list (currently it expects exactly 1 recording
      from `create-recording.yaml` running first).
- [ ] **Permission automation.** The `accept-mic-permission.yaml` sub-flow
      handles the iOS microphone dialog, but may need an equivalent for
      Android permission dialogs.
- [ ] **Maestro CI.** Wire the EAS workflow to GitHub Actions (see
      [EAS Workflows triggers](https://docs.expo.dev/eas/workflows/get-started/#create-a-workflow)).
- [ ] **Flaky test resilience.** Add retry logic or conditional waits for
      async operations (upload status changes, backend latency).
