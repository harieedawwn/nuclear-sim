# PLAN – PWR simulator 3D showcase

## Milestones
- [x] 0. Read files, backup (../nuclear-sim-backup-original)
- [ ] 1. Vite + GitHub Pages deploy of current app (live early)
- [ ] 2. 3D scene (Three.js) with automatic 2D fallback (scene2d.js)
- [ ] 3. UI redesign (side panel / bottom sheet, energy chain, gauge, tour, quality)
- [ ] 4. Procedural Web Audio sound
- [ ] 5. README, OG image, icons, screenshots (Playwright → docs/)
- [ ] 6. Polish + final verification on live URL

## Key decisions
- sim-core.js + test_sim.js stay at repo root, unchanged (CommonJS test, `npm test`).
- package.json has no "type":"module" (test uses require); vite config is .mjs.
- Vite base './' (relative URLs, works under /nuclear-sim/). Pages via Actions.
- Three.js r187 WebGLRenderer (iOS 15 safe), merged static geometry by material
  with vertex colors, InstancedMesh for repeats; generated sky PMREM (no HDR download).
- Software GL (SwiftShader/llvmpipe) or no WebGL → 2D scene, unless quality set manually.
- Fonts via @fontsource/be-vietnam-pro (self-hosted by Vite build).
- Physics overshoot at w>75 (REVIEW #6) left unchanged: not a code bug, a tuning choice.

## Commands
npm install · npm run dev · npm run build · npm test · node tests/e2e.mjs

## Next step
Milestone 1: push, enable Pages, confirm live URL.
