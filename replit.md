# Koncept Paint Booth

The imported app uses TypeScript, Vite, and Three.js. Keep its existing structure and stack.

## Run on Replit

- Runtime: Node.js 22 (the tests require Node.js 22.6 or later).
- Install dependencies: `npm ci`.
- Click Run to start the `Start application` workflow, which runs the passcode-protected `npm run dev` server.
- The server listens on `0.0.0.0:5000`; Vite allows Replit's preview proxy hosts.
- Set `PASSCODE` to exactly six digits in Replit Secrets. `SESSION_SECRET` signs the app's HTTP-only session cookie.
- For production, run `npm run build` and then `npm run start`; do not serve `dist/` as static files, which would bypass the gate.

## Koncept Kits paint library

- The **Library** tab's **Koncept Kits library** section saves paints to Postgres (`paint_library`,
  created on start) for the Koncept Kits app to use when rendering cars.
- Set `PAINT_LIBRARY_KEY` in Replit Secrets to a random value of 32 or more characters, and the same
  value in Koncept Kits. Koncept Kits reads `GET /api/library/export` with `Authorization: Bearer <key>`;
  without the key that endpoint answers 503.
- Without `DATABASE_URL` the library is kept in memory and lost on restart.

## Checks

- `npm test` runs auth, colour, calibration, mixing, and print-sheet tests.
- `npm run test:replit` runs browser, saved-mix, and calibration-backup tests; it requires Chromium.
- `npm run build` type-checks the project and builds the static site into `dist/`.
- `npm run typecheck` runs the TypeScript check alone.

The production build keeps relative asset paths. The app uses browser-local storage; saved data is not shared across devices.
