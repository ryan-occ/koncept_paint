# Koncept Paint Booth

The imported app uses TypeScript, Vite, and Three.js. Keep its existing structure and stack.

## Run on Replit

- Runtime: Node.js 22 (the tests require Node.js 22.6 or later).
- Install dependencies: `npm ci`.
- Click Run to start the `Start application` workflow, which runs `npm run dev`.
- Vite listens on `0.0.0.0:5000` and allows Replit's preview proxy hosts.
- No secrets, database, or external services are required.

## Checks

- `npm test` runs the colour, mixing, and calibration tests.
- `npm run build` type-checks the project and builds the static site into `dist/`.
- `npm run typecheck` runs the TypeScript check alone.

The production build keeps relative asset paths. The app uses browser-local storage; saved data is not shared across devices.
