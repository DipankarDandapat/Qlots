# Qlots — Google Play release readiness

## Current status

- [x] Python FastAPI API and JavaScript Expo/React Native Android MVP source created.
- [x] Production-mode Android JavaScript bundle exported and Expo Doctor passed.
- [x] API regression suite passed (5 tests).
- [x] Standalone release-variant test APK built, package identity and v2 signature verified; it uses the Android debug key and emulator API URL.
- [ ] Signed Android App Bundle (`.aab`) built.
- [ ] Production API deployed over HTTPS with durable storage.
- [ ] Play Console listing and policy disclosures completed.
- [ ] Release uploaded, tested and approved for public rollout.

**No `.aab` has been built or uploaded.** The local test APK is not a Play Store release: it uses the debug signing key and is configured for the Android emulator API address. The Android SDK is now installed in the Sandbox, but no Google Play integration or Play Console credentials are configured.

## Required before a public release

1. **Production API:** choose/authorize a hosting provider; deploy FastAPI behind HTTPS with PostgreSQL, migrations, encrypted storage/backups, monitoring and a non-default `JWT_SECRET`. Set explicit `CORS_ORIGINS`. Replace the example `EXPO_PUBLIC_API_URL` with the real HTTPS API origin and create a production app build.
2. **Production readiness:** conduct a security and qualified financial-calculation review. SQLite is only the local default, entered records are not currently encrypted at rest by this code, authentication recovery/MFA is not implemented, and the account-data deletion endpoint does not yet have an in-app Settings flow.
3. **Store policy:** publish an accurate privacy policy/contact page and complete Google Play Data safety, financial-feature disclosures, content rating, target-API and any account deletion requirements. Confirm the exact data collected, processed, stored and retained by the deployed API before answering Play Console forms.
4. **Listing assets:** finalize app title/description, icon, screenshots, feature graphic, support contact and any required regional disclosures.
5. **Signed build:** use a machine with the Android SDK or an explicitly authorized build service, configure protected Android upload-signing credentials, increment the version code on subsequent uploads, and produce the `.aab` for package `com.qlots.app`.
6. **Testing:** upload first to an internal testing track, verify install/login/data isolation/API behavior and disclosures on real Android devices, and address review feedback.
7. **Public rollout:** before a production-track rollout, review the exact bundle, listing, data disclosures and rollout track. Public publication is a consequential external action and should be confirmed against that exact release payload.

## Build command after prerequisites

```bash
cd mobile
EXPO_PUBLIC_API_URL=https://<your-api-domain> npx eas-cli build -p android --profile production
```

This cloud build uploads selected app source to Expo's build service, so use it only if that service is authorized; otherwise build locally on a machine with Android Studio/SDK configured. The project does not contain a production upload key or Play service-account credentials.
