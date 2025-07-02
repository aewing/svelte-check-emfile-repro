# EMFILE Reproduction Test Instructions

## Simple Test

```bash
cd repro-test
npm install
npm run generate-test-files  # Creates ~2000 files in excluded directories  
npm run test-emfile         # Sets ulimit to 128 and runs svelte-check
```

**Expected result**: EMFILE error because svelte-check tries to watch files that TSConfig excludes.

## What This Test Proves

1. **TSConfig excludes directories** - The `tsconfig.json` explicitly excludes `large-excluded/**`, `dist/**`, etc.
2. **svelte-check watches them anyway** - Despite TSConfig excludes, svelte-check will try to watch files in these directories
3. **EMFILE occurs** - On systems with low file descriptor limits, this causes "too many open files" errors

## Expected vs Actual Output

### Expected (if TSConfig excludes were respected):
```
Checking /path/to/repro-test...
Found 3 files to check
No errors found
Watching for changes...
```

### Actual (what you'll see):
```
Error: EMFILE: too many open files, watch '/path/to/repro-test/large-excluded/file1.ts'
```

## The Problem

- **TSConfig excludes** the `large-excluded` directory
- **svelte-check still tries to watch** files in that directory  
- **EMFILE occurs** because ulimit is set to 128 but svelte-check tries to watch 2000+ files

## The Fix We Need

svelte-check should either:
1. **Respect TSConfig excludes for file watching** (ideal)
2. **Provide configuration for file watching patterns** (our proposed solution)
3. **Gracefully handle EMFILE errors** (fallback)

This reproduction proves that option 1 doesn't currently work, making option 2 necessary.