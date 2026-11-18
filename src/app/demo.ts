// True only in the public demo build (`pnpm build:demo`, see vite.config.ts); the full build and the tests are not demos.
declare const __DEMO__: boolean;
export const isDemo = typeof __DEMO__ !== 'undefined' && __DEMO__;
