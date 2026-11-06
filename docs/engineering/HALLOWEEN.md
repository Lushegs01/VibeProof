# Haunt the Chain visual edition

VibeProof uses a midnight-plum canvas, warm parchment text, ember-orange controls and
spectral-green seasonal accents. The shared design tokens carry through discovery,
passports, creator history, forms, search, navigation and embeds. Evidence retains its
explicit fact, observation, creator-claim and unavailable labels.

The home page pairs “Proof over ghost stories” with an original inline SVG: a curious
ghost and lantern, an evidence journal, bats, a harvest moon and a jack-o'-lantern. It is
server-rendered, decorative, and requires no additional client JavaScript, third-party
assets, network requests or dependencies. A slow CSS float respects reduced-motion
preferences. The favicon and generated homepage/passport sharing cards use the same palette.
The homepage keeps actual indexed metrics and clearly labelled demo fixtures.

The primary files are `src/app/globals.css`, `src/components/seasonal/haunted-scene.tsx`,
`src/app/(site)/page.tsx`, the shared layout components and the Open Graph image routes.
Palette values live in the existing Tailwind `@theme` block. Seasonal copy does not encode
an event countdown or claim official selection.

Verification includes production and demo builds, TypeScript checks, the existing desktop
and mobile browser journeys, visual inspection at desktop and phone sizes, 320px viewport
overflow checks, reduced-motion inspection and fetching the image URL published in the
page's Open Graph metadata. Screenshots use labelled demo data. Backend logic and Solidity
are outside this visual change.

Executed checks: production and demo builds passed; `npm run lint` and formatting checks
passed; Playwright passed 11 desktop/mobile cases in 29.7 seconds, with the existing
mobile keyboard-shortcut case skipped. The first production browser run had API failures
because test Redis was stopped; starting Redis and supplying REDIS_URL restored the
expected behavior without changing request protection or browser assertions.

```sh
npm run build
npm run test:e2e:build
PW_CHROMIUM_PATH=/usr/bin/chromium REDIS_URL=redis://127.0.0.1:6379 npm run test:e2e
npm run lint
npm run format:check
```
