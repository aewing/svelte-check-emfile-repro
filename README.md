# EMFILE Reproduction Test

Simple reproduction showing svelte-check watches files excluded by TSConfig.

## Problem

svelte-check hits EMFILE because it watches files that TSConfig excludes. The file watcher ignores TSConfig exclude patterns.

## Test

```bash
npm install
npm run reset      # Clean + generate files
npm run test-emfile # Sets ulimit=128, runs svelte-check --watch
```

**Result**: EMFILE error because svelte-check tries to watch excluded files.

## Proof

- TSConfig excludes `large-excluded/**`
- svelte-check still watches files in `large-excluded/`
- EMFILE occurs when it hits the 128 file limit