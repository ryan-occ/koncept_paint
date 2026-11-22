# Koncept Paint Booth

A paint booth simulator for custom work: mix toners, build a paint system coat by coat
(ground, base, mid-coat powders, candy, clear), preview it in 3D under booth, sun, overcast,
sunset or street lighting, and get a recipe card with an application guide. A calibration
tool turns phone photos of real test cards into measured toner data, so predictions are based on
your own materials.

## Run it

```bash
npm install
npm run dev        # local dev server
npm test           # 20 colour, mixing, calibration, and print-sheet tests
npm run test:replit # browser, saved-mix, and calibration-backup regression tests
npm run build      # type-check + production build into dist/
```

If Chromium is not already installed, install the browser used by the extended regression tests with
`npx playwright install chromium`.

The build uses relative paths, so `dist/` can be hosted anywhere (GitHub Pages, Netlify, a
shop PC).

Saved mixes stay in the current browser unless you export them. Use **Export saved mixes** and
**Import backup** on the mixing bench to move recipes between browsers; an invalid backup leaves
the existing saved mixes unchanged.

## Project layout

```
src/
  color/
    space.ts          sRGB ↔ linear, Lab, CIEDE2000
    mixing.ts         two-constant Kubelka-Munk toner mixing, layer stack → flat colour
    calibration.ts    ColorChecker photo correction, tint-strength solve, verdicts
  data/
    toners.ts         toners (masstone, hiding, scattering), grounds, base-coat pearls
    powders.ts        mid-coat effect pigments by family
    presets.ts        starting mixes
  render/
    booth.ts          Three.js scene, camera controls, paint system → physical material
    lighting.ts       lighting presets as environment maps
    shapes.ts         test panel, sphere, procedural car
  ui/
    store.ts          shared state, storage helpers
    bench.ts          mixing bench, recipe card, application guide
    calibrate.ts      calibration panel
  guide.ts            layer summary, application guide, recipe text
  main.ts
tests/                node:test suites for colour maths, mixing and calibration
```

## How the colour model works

- **Mixing** uses two-constant Kubelka-Munk per RGB channel. Each toner has a masstone colour
  (its reflectance at full hide) and a relative scattering value: white scatters strongly,
  black and transparent organics weakly. That is why a little black darkens white gradually
  instead of turning it black.
- **Hiding**: base coats cover the ground by `1 − (1 − h)^coats`.
- **Mid-coat powders** and **candy** are applied on top of the flat colour; their angle-dependent
  look is drawn by the 3D material (iridescence, sheen, flake normal maps).
- **ΔE2000** is used for every accuracy number shown in the app; it is tested against the
  Sharma, Wu & Dalal (2005) reference data.

## Accuracy

Out of the box the toners are generic, so treat colours as a guide. To make them match your
materials:

1. Spray a card of each toner on its own (masstone) and one with white at a known ratio (tint).
2. Photograph each card beside a ColorChecker Classic in even light, no flash or glare.
3. In the Calibrate panel, click the six chart patches and the paint, then save the reading.
4. Spray a few real recipes and log them as mix checks. Under ΔE 2 on average means the
   simulator is reliable for solid colours with your materials.

Phone photos calibrate solid colour only. Pearl, flake and candy effects depend on angle and
remain visual estimates unless measured with a multi-angle spectrophotometer. Screen calibration
also affects what you see; trust the ΔE numbers over the swatch.

Brand names in the powder list are examples of each product family, not exact reproductions.
Mix ratios on the recipe card are toner ratios only: binder, reducer and hardener follow the
paint system's technical data sheet.
