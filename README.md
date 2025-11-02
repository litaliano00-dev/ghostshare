# GhostShare Backend & Tooling

A reorganized workspace for the GhostShare secure messaging platform. The repository now separates runtime code from platform tooling, making it easier to navigate, test, and deploy the different pieces of the stack.

## Key Areas

- `backend/` — Express + Socket.IO API server, static assets, and persistent storage directories.
- `src/` — TypeScript sources for cryptographic primitives and shared utilities.
- `dist/` — Generated JS bundles derived from the TypeScript sources.
- `mobile/` — Platform-specific projects.
	- `mobile/android-sdk/` — Capacitor Android source tree.
	- `mobile/ios-sdk/` — Capacitor iOS project scaffolding.
	- `mobile/android-build/` — Consolidated Android build outputs (`artifacts/`).
- `vendor/` — Third-party libraries.
	- `vendor/node/` — Scoped and unscoped npm packages bundled with the repo.
	- `vendor/noble-hashes/` — Distribution files for the bundled `@noble/hashes` modules.

## Working With The Repo

```bash
# install dependencies
yarn install

# run the backend API (serves static content from backend/public)
yarn start

# iterate on the API with auto-reload
yarn dev

# build Android (from mobile/android-sdk)
(cd mobile/android-sdk && ./gradlew assembleDebug)
```

## Next Steps

- Trim or regenerate the contents of `vendor/` if you decide to rely on `npm install` instead of committed packages.
- Add tests for the reorganized backend, especially around the persistence layer in `backend/server.js`.
- Update Capacitor and mobile platform configs if additional restructure is required.
