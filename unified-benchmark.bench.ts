import { bench, describe, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess, execSync } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

interface WatcherProcess {
  process: ChildProcess;
  stdout: string;
  stderr: string;
  lastStartMarker: number;
  lastEndMarker: number;
}

interface BenchmarkStats {
  totalDuration: number;
  initialRunTime: number;
  changeTimings: number[];
  averageChangeTime: number;
  medianChangeTime: number;
  minChangeTime: number;
  maxChangeTime: number;
}

const benchmarkResults: Map<string, BenchmarkStats[]> = new Map();
const benchmarkErrors: Map<string, Error> = new Map();

// Markers to detect when svelte-check starts and completes
const START_MARKER = 'File change detected';
const END_MARKERS = ['Watching for file changes', 'svelte-check found', 'found 0 errors', 'Found '];

/**
 * Run svelte-check in watch mode
 */
function runSvelteCheckWatch(command: string, cwd: string): WatcherProcess {
  console.log(`Spawning: ${command} --watch in ${cwd}`);
  const child = spawn('bash', ['-c', `${command} --watch`], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const watcher: WatcherProcess = {
    process: child,
    stdout: '',
    stderr: '',
    lastStartMarker: -1,
    lastEndMarker: -1
  };

  child.stdout.on('data', (data) => {
    const chunk = data.toString();
    watcher.stdout += chunk;
    
    // Update marker positions
    const startPos = watcher.stdout.lastIndexOf(START_MARKER);
    if (startPos > watcher.lastStartMarker) {
      watcher.lastStartMarker = startPos;
    }
    
    for (const endMarker of END_MARKERS) {
      const endPos = watcher.stdout.lastIndexOf(endMarker);
      if (endPos > watcher.lastEndMarker) {
        watcher.lastEndMarker = endPos;
      }
    }
  });

  child.stderr.on('data', (data) => {
    const chunk = data.toString();
    watcher.stderr += chunk;
    // Log errors immediately
    if (chunk.trim()) {
      console.error(`[${command}] stderr:`, chunk.trim());
    }
  });
  
  child.on('error', (error) => {
    console.error(`[${command}] spawn error:`, error);
  });
  
  child.on('exit', (code, signal) => {
    if (code !== null || signal !== null) {
      console.error(`[${command}] exited with code ${code}, signal ${signal}`);
    }
  });

  return watcher;
}

/**
 * Check if svelte-check is currently processing
 */
function isProcessing(watcher: WatcherProcess): boolean {
  return watcher.lastStartMarker > watcher.lastEndMarker;
}

/**
 * Wait for initial check to complete
 */
async function waitForInitialCheck(watcher: WatcherProcess, timeout: number = 3000): Promise<void> {
  const startTime = Date.now();
  
  return new Promise((resolve, reject) => {
    let lastOutputLength = 0;
    const checkInterval = setInterval(() => {
      // Log any new output
      if (watcher.stdout.length > lastOutputLength) {
        const newOutput = watcher.stdout.substring(lastOutputLength);
        console.log(`[Initial check] New output:`, newOutput.trim());
        lastOutputLength = watcher.stdout.length;
      }
      
      // Check if we've seen any end marker
      if (watcher.lastEndMarker !== -1) {
        clearInterval(checkInterval);
        resolve();
      } else if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        console.error(`[Initial check] Timeout! Last output:`, watcher.stdout.slice(-500));
        console.error(`[Initial check] Stderr:`, watcher.stderr);
        reject(new Error('Timeout waiting for initial check to complete'));
      }
    }, 100);
  });
}

/**
 * Wait for any pending check to complete
 */
async function waitForPendingCheck(watcher: WatcherProcess, timeout: number = 3000): Promise<void> {
  if (!isProcessing(watcher)) {
    return; // No pending check
  }
  
  const startTime = Date.now();
  
  return new Promise((resolve, reject) => {
    const checkInterval = setInterval(() => {
      if (!isProcessing(watcher)) {
        clearInterval(checkInterval);
        resolve();
      } else if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        reject(new Error('Timeout waiting for pending check to complete'));
      }
    }, 100);
  });
}

/**
 * Wait for the next check to complete after making changes
 */
async function waitForNextCheck(watcher: WatcherProcess, timeout: number = 3000): Promise<number> {
  const startTime = Date.now();
  const initialEndMarker = watcher.lastEndMarker;
  
  return new Promise((resolve, reject) => {
    const checkInterval = setInterval(() => {
      if (watcher.lastEndMarker > initialEndMarker && !isProcessing(watcher)) {
        clearInterval(checkInterval);
        resolve(Date.now() - startTime);
      } else if (Date.now() - startTime > timeout) {
        clearInterval(checkInterval);
        reject(new Error('Timeout waiting for next check to complete'));
      }
    }, 100);
  });
}

/**
 * Get random .svelte files from the project
 */
function getRandomSvelteFiles(dir: string, count: number): string[] {
  const svelteFiles: string[] = [];
  
  function findSvelteFiles(currentDir: string) {
    if (!existsSync(currentDir)) return;
    
    const entries = readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(currentDir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'worktrees') {
        findSvelteFiles(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.svelte')) {
        svelteFiles.push(fullPath);
      }
    }
  }

  findSvelteFiles(dir);
  
  // Shuffle and take requested count
  const shuffled = svelteFiles.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/**
 * Add spaces to files
 */
async function addSpacesToFiles(files: string[]): Promise<void> {
  const promises = files.map(file => {
    return new Promise<void>((resolve) => {
      const content = readFileSync(file, 'utf-8');
      writeFileSync(file, content + ' ');
      resolve();
    });
  });
  await Promise.all(promises);
}

/**
 * Remove trailing spaces from files
 */
async function removeSpacesFromFiles(files: string[]): Promise<void> {
  const promises = files.map(file => {
    return new Promise<void>((resolve) => {
      const content = readFileSync(file, 'utf-8');
      writeFileSync(file, content.trimEnd());
      resolve();
    });
  });
  await Promise.all(promises);
}

/**
 * Calculate median of an array
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Run watch mode benchmark
 */
async function runWatchModeBenchmark(
  command: string, 
  cwd: string, 
  srcDir: string,
  label: string
): Promise<BenchmarkStats> {
  console.log(`\nStarting benchmark: ${label}`);
  const startTime = Date.now();
  let watcher: WatcherProcess | null = null;
  const changeTimings: number[] = [];
  
  try {
    watcher = runSvelteCheckWatch(command, cwd);
    
    // Wait for initial run to complete
    console.log('Waiting for initial run...');
    await waitForInitialCheck(watcher);
    const initialRunTime = Date.now() - startTime;
    console.log(`Initial run completed in ${(initialRunTime / 1000).toFixed(2)}s`);
    
    // Get 5 random svelte files
    const files = getRandomSvelteFiles(srcDir, 5);
    console.log(`Found ${files.length} svelte files for testing`);
    
    if (files.length === 0) {
      throw new Error('No svelte files found');
    }
    
    
      // Add spaces and wait for check
      const addStart = Date.now();
      await Promise.all([
        addSpacesToFiles(files),
        waitForNextCheck(watcher)
      ]);
      const addTime = Date.now() - addStart;
      changeTimings.push(addTime);
      
      // Remove spaces and wait for check
      const removeStart = Date.now();
      await Promise.all([
        removeSpacesFromFiles(files),
        waitForNextCheck(watcher)
      ]);
      const removeTime = Date.now() - removeStart;
      changeTimings.push(removeTime);
    
    // Kill the watcher
    watcher.process.kill();
    
    const stats: BenchmarkStats = {
      totalDuration: Date.now() - startTime,
      initialRunTime,
      changeTimings,
      averageChangeTime: changeTimings.reduce((a, b) => a + b, 0) / changeTimings.length,
      medianChangeTime: median(changeTimings),
      minChangeTime: Math.min(...changeTimings),
      maxChangeTime: Math.max(...changeTimings)
    };
    
    console.log(`Benchmark completed: ${label}`);
    console.log(`  Total time: ${(stats.totalDuration / 1000).toFixed(2)}s`);
    console.log(`  Average change time: ${stats.averageChangeTime.toFixed(0)}ms`);
    
    // Store results
    if (!benchmarkResults.has(label)) {
      benchmarkResults.set(label, []);
    }
    benchmarkResults.get(label)!.push(stats);
    
    return stats;
  } catch (error) {
    console.error(`Error in benchmark ${label}:`, error);
    if (watcher) {
      watcher.process.kill();
    }
    
    // Store the error for reporting
    benchmarkErrors.set(label, error as Error);
    
    // Return a failed benchmark result instead of throwing
    const failedStats = {
      totalDuration: Date.now() - startTime,
      initialRunTime: 0,
      changeTimings: [],
      averageChangeTime: 0,
      medianChangeTime: 0,
      minChangeTime: 0,
      maxChangeTime: 0
    };
    
    // Still store the failed result
    if (!benchmarkResults.has(label)) {
      benchmarkResults.set(label, []);
    }
    benchmarkResults.get(label)!.push(failedStats);
    
    return failedStats;
  }
}

/**
 * Run all benchmarks in parallel for speed
 */
async function runAllBenchmarksParallel(): Promise<void> {
  console.log('\n🚀 Running all benchmarks in parallel...\n');
  
  const benchmarkConfigs = [
    {
      label: 'npm-no-worktrees',
      command: 'node_modules/.bin/svelte-check',
      cwd: './temp/no-worktrees',
      srcDir: './temp/no-worktrees/src'
    },
    {
      label: 'npm-with-worktrees', 
      command: 'node_modules/.bin/svelte-check',
      cwd: './temp/with-worktrees',
      srcDir: './temp/with-worktrees/src'
    },
    {
      label: 'custom-no-worktrees',
      command: '../../../language-tools/packages/svelte-check/bin/svelte-check',
      cwd: './temp/no-worktrees',
      srcDir: './temp/no-worktrees/src'
    },
    {
      label: 'custom-with-worktrees',
      command: '../../../language-tools/packages/svelte-check/bin/svelte-check', 
      cwd: './temp/with-worktrees',
      srcDir: './temp/with-worktrees/src'
    }
  ];
  
  // Run all benchmarks in parallel with timeout
  const promises = benchmarkConfigs.map(config => {
    const timeoutPromise = new Promise<null>((_, reject) => 
      setTimeout(() => reject(new Error(`Benchmark ${config.label} timed out after 2 minutes`)), 120000)
    );
    
    return Promise.race([
      runWatchModeBenchmark(config.command, config.cwd, config.srcDir, config.label),
      timeoutPromise
    ]).catch(error => {
      console.error(`\nError in ${config.label}:`, error.message);
      return null;
    });
  });
  
  await Promise.all(promises);
  console.log('\n✅ All parallel benchmarks completed\n');
}

describe('svelte-check comprehensive performance test', () => {
  beforeAll(() => {
    // Auto-setup environments if they don't exist
    console.log('Ensuring benchmark environments are ready...');
    execSync('node scripts/setup-benchmark-environments.js', { stdio: 'inherit' });
  });
  
  // Single benchmark that runs all scenarios in parallel
  bench('all scenarios (parallel)', async () => {
    const startTime = Date.now();
    await runAllBenchmarksParallel();
    return Date.now() - startTime;
  }, {
    iterations: 5, // Reduced for speed
    timeout: 60000 // 1 minutes total
  });

  // Scenario 1: Current npm svelte-check without worktrees
  bench('npm svelte-check (no worktrees)', async () => {
    const stats = await runWatchModeBenchmark(
      'node_modules/.bin/svelte-check',
      './temp/no-worktrees',
      './temp/no-worktrees/src',
      'npm-no-worktrees'
    );
    return stats.totalDuration;
  }, {
    iterations: 5,
    timeout: 30000
  });

  // Scenario 2: Current npm svelte-check with worktrees
  bench('npm svelte-check (with worktrees)', async () => {
    const stats = await runWatchModeBenchmark(
      'node_modules/.bin/svelte-check',
      './temp/with-worktrees',
      './temp/with-worktrees/src',
      'npm-with-worktrees'
    );
    return stats.totalDuration;
  }, {
    iterations: 5,
    timeout: 30000
  });

  // Scenario 3: Custom svelte-check without worktrees
  bench('custom svelte-check (no worktrees)', async () => {
    const stats = await runWatchModeBenchmark(
      '../../../language-tools/packages/svelte-check/bin/svelte-check',
      './temp/no-worktrees',
      './temp/no-worktrees/src',
      'custom-no-worktrees'
    );
    return stats.totalDuration;
  }, {
    iterations: 5,
    timeout: 30000
  });

  // Scenario 4: Custom svelte-check with worktrees
  bench('custom svelte-check (with worktrees)', async () => {
    const stats = await runWatchModeBenchmark(
      '../../../language-tools/packages/svelte-check/bin/svelte-check',
      './temp/with-worktrees',
      './temp/with-worktrees/src',
      'custom-with-worktrees'
    );
    return stats.totalDuration;
  }, {
    iterations: 5,
    timeout: 30000
  });

  afterAll(() => {
    console.log('\n\n=== COMPREHENSIVE BENCHMARK SUMMARY ===\n');
    
    // Report any errors first
    if (benchmarkErrors.size > 0) {
      console.log('=== BENCHMARK ERRORS ===');
      for (const [label, error] of benchmarkErrors.entries()) {
        console.log(`\n${label}: ${error.message}`);
        if (error.stack) {
          console.log(error.stack.split('\n').slice(1, 4).join('\n'));
        }
      }
      console.log('\n');
    }
    
    // Display results for each scenario
    for (const [label, runs] of benchmarkResults.entries()) {
      const avgTotal = runs.reduce((a, b) => a + b.totalDuration, 0) / runs.length;
      const avgInitial = runs.reduce((a, b) => a + b.initialRunTime, 0) / runs.length;
      const avgChange = runs.reduce((a, b) => a + b.averageChangeTime, 0) / runs.length;
      const medChange = median(runs.map(r => r.medianChangeTime));
      
      console.log(`${label}:`);
      console.log(`  Average total time: ${(avgTotal / 1000).toFixed(2)}s`);
      console.log(`  Average initial run: ${(avgInitial / 1000).toFixed(2)}s`);
      console.log(`  Average change time: ${avgChange.toFixed(0)}ms`);
      console.log(`  Median change time: ${medChange.toFixed(0)}ms`);
      console.log();
    }
    
    // Compare npm vs custom (no worktrees)
    const npmNoWT = benchmarkResults.get('npm-no-worktrees');
    const customNoWT = benchmarkResults.get('custom-no-worktrees');
    
    if (npmNoWT && customNoWT) {
      const npmAvg = npmNoWT.reduce((a, b) => a + b.averageChangeTime, 0) / npmNoWT.length;
      const customAvg = customNoWT.reduce((a, b) => a + b.averageChangeTime, 0) / customNoWT.length;
      const improvement = ((npmAvg - customAvg) / npmAvg) * 100;
      
      console.log('=== PERFORMANCE COMPARISON (No Worktrees) ===');
      console.log(`Custom implementation improvement: ${improvement.toFixed(1)}%`);
      console.log(`npm: ${npmAvg.toFixed(0)}ms per change`);
      console.log(`custom: ${customAvg.toFixed(0)}ms per change`);
      console.log();
    }
    
    // Compare npm vs custom (with worktrees)
    const npmWithWT = benchmarkResults.get('npm-with-worktrees');
    const customWithWT = benchmarkResults.get('custom-with-worktrees');
    
    if (npmWithWT && customWithWT) {
      const npmAvg = npmWithWT.reduce((a, b) => a + b.averageChangeTime, 0) / npmWithWT.length;
      const customAvg = customWithWT.reduce((a, b) => a + b.averageChangeTime, 0) / customWithWT.length;
      const improvement = ((npmAvg - customAvg) / npmAvg) * 100;
      
      console.log('=== PERFORMANCE COMPARISON (With Worktrees) ===');
      console.log(`Custom implementation improvement: ${improvement.toFixed(1)}%`);
      console.log(`npm: ${npmAvg.toFixed(0)}ms per change`);
      console.log(`custom: ${customAvg.toFixed(0)}ms per change`);
      console.log();
    }
    
    // Show impact of worktrees
    if (npmNoWT && npmWithWT) {
      const noWTAvg = npmNoWT.reduce((a, b) => a + b.averageChangeTime, 0) / npmNoWT.length;
      const withWTAvg = npmWithWT.reduce((a, b) => a + b.averageChangeTime, 0) / npmWithWT.length;
      const impact = ((withWTAvg - noWTAvg) / noWTAvg) * 100;
      
      console.log('=== IMPACT OF WORKTREES (npm) ===');
      console.log(`Performance impact: ${impact > 0 ? '+' : ''}${impact.toFixed(1)}%`);
      console.log(`Without worktrees: ${noWTAvg.toFixed(0)}ms per change`);
      console.log(`With worktrees: ${withWTAvg.toFixed(0)}ms per change`);
    }
  });
});
