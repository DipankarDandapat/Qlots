# Qlots — Android personal-finance MVP

Qlots brings manually entered assets, liabilities, income and expenses into one financial-health view. This plain-local project uses **FastAPI/Python** for the API and **Expo/React Native (JavaScript)** for Android.

## Implemented MVP

- Email/password registration and login; per-user API data boundaries and bearer sessions.
- INR asset, debt, income and expense records with add/remove flows.
- Dashboard for net worth, asset categories, monthly cash flow, health indicator and 1-/5-year projections.
- Editable projection assumptions and conservative/base/optimistic scenario comparisons.
- Estimated fixed-deposit accrual and loan amortization.
- Calculation-backed finance helper (deliberately not an external LLM in this local MVP).
- PDF snapshot generation and Android share sheet.
- User-scoped history snapshots and account-data deletion API.

## Start the API

```bash
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env .env  # optional for local defaults
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Interactive API documentation: `http://127.0.0.1:8000/docs`.

For an Android emulator, the app defaults to `http://10.0.2.2:8000`. For a physical phone, set `EXPO_PUBLIC_API_URL` to the computer's reachable LAN URL (and use a suitable local network setup).

## Run the Android client

```bash
cd mobile
npm install
npx expo start
```

Open the project in an Android emulator or Expo Go. `npm run android` requires Android Studio/SDK and an emulator on the developer's computer. To export the JS Android bundle without an SDK, run `npx expo export --platform android`.

## Build an Android App Bundle

The production profile in `mobile/eas.json` requests an `.aab` and disables Android cleartext HTTP. Set `EXPO_PUBLIC_API_URL` to the **deployed HTTPS API** before creating a production build. Then use Expo Application Services (EAS) with an Expo account:

```bash
cd mobile
npx eas-cli build -p android --profile production
```

The EAS production build needs an EAS account and Android production-signing credentials. The Android SDK is installed in this Sandbox, but no Play Console integration or credentials are configured. No signed `.aab` has been built and nothing has been uploaded. A public release also needs the Qlots API deployed over HTTPS, accurate privacy/data-safety disclosures, store listing assets and review of the final release. Public submission is a separate step.

**Test APK:** A standalone release-variant APK was built locally and is delivered separately as `qlots-android-test.apk`. It is signed with the standard Android debug key, is for review/testing only (not Play Store submission), and embeds `http://10.0.2.2:8000` for an Android emulator talking to an API running on the host machine. A physical phone will need a reachable API URL and a rebuilt APK.

## Important production work still required

This is a development MVP, **not yet suitable for real financial data or production release**. Before serving real users:

1. Deploy the API on a managed HTTPS host; use PostgreSQL, backups, migrations, monitoring, rate limits and managed secrets. SQLite is only the local default.
2. Set `APP_ENV=production`, a unique high-entropy `JWT_SECRET`, and explicit production CORS origins; never use the local default secret.
3. Complete security review, account recovery/MFA, data-export/deletion UX, logging/retention review and penetration testing.
4. Validate financial calculations with qualified review. FD compounding is an estimate (actual bank conventions, payout, tax and premature-withdrawal terms can differ); projections and the health indicator are illustrative, not guaranteed returns or advice.
5. Add the missing product features/integrations before claiming full PRD completion. This MVP has no bank/broker sync, market pricing, RD-specific maturity model, XIRR, automatic transaction import, real generative AI or full nine-page report.
6. Configure a privacy policy and complete Play Console Data safety, account deletion, target API, content rating, testing-track and app listing requirements for the actual release.
7. Re-review the npm audit report before shipping. The current Expo dependency tree reports 11 moderate findings and no high/critical findings; the suggested broad fix would downgrade Expo across major versions, so it was not applied blindly.

## API tests

```bash
cd backend
. .venv/bin/activate
pytest -q
```
