import { bench, describe, beforeAll, afterAll } from 'vitest';
import { spawn, ChildProcess, execSync } from 'child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';

interface WatcherProcess {
  process: ChildProcess;
  stdout: string;
  stderr: string;
}

interface BenchmarkStats {
  totalDuration: number;
  initialRunTime: number;
  batchTimings: number[];
  averageBatchTime: number;
  medianBatchTime: number;
  minBatchTime: number;
  maxBatchTime: number;
}

const benchmarkResults: Map<string, BenchmarkStats[]> = new Map();
const MAIN_REPO = './temp-worktrees/main-repo';

/**
 * Run svelte-check in watch mode
 */
function runSvelteCheckWatch(command: string): WatcherProcess {
  const child = spawn('bash', ['-c', `${command} --watch`], {
    cwd: MAIN_REPO,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const watcher: WatcherProcess = {
    process: child,
    stdout: '',
    stderr: ''
  };

  child.stdout.on('data', (data) => {
    watcher.stdout += data.toString();
  });

  child.stderr.on('data', (data) => {
    watcher.stderr += data.toString();
  });

  return watcher;
}

/**
 * Wait for svelte-check to complete initial run or file change run
 */
function waitForCheckComplete(watcher: WatcherProcess, timeout: number = 30000): Promise<number> {
  const startTime = Date.now();
  
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      reject(new Error('Timeout waiting for svelte-check to complete'));
    }, timeout);

    const checkOutput = () => {
      // Look for completion patterns in stdout
      if (watcher.stdout.includes('Watching for file changes') || 
          watcher.stdout.includes('svelte-check found') ||
          watcher.stdout.includes('found 0 errors')) {
        clearTimeout(timeoutId);
        clearInterval(interval);
        resolve(Date.now() - startTime);
      }
    };

    // Check existing output
    checkOutput();

    // Watch for new output
    const originalStdout = watcher.stdout;
    const interval = setInterval(() => {
      if (watcher.stdout !== originalStdout) {
        checkOutput();
      }
    }, 10);
  });
}

/**
 * Get random .svelte files from the project
 */
function getRandomSvelteFiles(count: number): string[] {
  const svelteFiles: string[] = [];
  
  function findSvelteFiles(dir: string) {
    if (!existsSync(dir)) return;
    
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'worktrees') {
        findSvelteFiles(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.svelte')) {
        svelteFiles.push(fullPath);
      }
    }
  }

  findSvelteFiles(join(MAIN_REPO, 'src'));
  
  // Shuffle and take requested count
  const shuffled = svelteFiles.sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/**
 * Add spaces to the end of a file
 */
function addSpacesToFile(filePath: string): void {
  const content = readFileSync(filePath, 'utf-8');
  writeFileSync(filePath, content + '    ');
}

/**
 * Remove trailing spaces from a file
 */
function removeSpacesFromFile(filePath: string): void {
  const content = readFileSync(filePath, 'utf-8');
  writeFileSync(filePath, content.trimEnd());
}

/**
 * Calculate median of an array
 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Run watch mode benchmark
 */
async function runWatchModeBenchmark(command: string, label: string): Promise<BenchmarkStats> {
  const startTime = Date.now();
  const watcher = runSvelteCheckWatch(command);
  const batchTimings: number[] = [];
  const batchSize = 10;
  
  try {
    // Wait for initial run to complete
    const initialRunTime = await waitForCheckComplete(watcher);
    
    // Get 50 random svelte files
    const files = getRandomSvelteFiles(50);
    
    // Perform changes in batches of 10
    
    // Add spaces to files in batches
    for (let i = 0; i < files.length; i += batchSize) {
      const batchStart = Date.now();
      const batch = files.slice(i, i + batchSize);
      
      // Make all changes in the batch
      for (const file of batch) {
        addSpacesToFile(file);
      }
      
      // Wait for svelte-check to process the batch
      watcher.stdout = '';
      await waitForCheckComplete(watcher, 15000);
      batchTimings.push(Date.now() - batchStart);
    }
    
    // Remove spaces from files in batches
    for (let i = 0; i < files.length; i += batchSize) {
      const batchStart = Date.now();
      const batch = files.slice(i, i + batchSize);
      
      // Make all changes in the batch
      for (const file of batch) {
        removeSpacesFromFile(file);
      }
      
      // Wait for svelte-check to process the batch
      watcher.stdout = '';
      await waitForCheckComplete(watcher, 15000);
      batchTimings.push(Date.now() - batchStart);
    }
    
    // Kill the watcher
    watcher.process.kill();
    
    const stats: BenchmarkStats = {
      totalDuration: Date.now() - startTime,
      initialRunTime,
      batchTimings,
      averageBatchTime: batchTimings.reduce((a, b) => a + b, 0) / batchTimings.length,
      medianBatchTime: median(batchTimings),
      minBatchTime: Math.min(...batchTimings),
      maxBatchTime: Math.max(...batchTimings)
    };
    
    // Store results
    if (!benchmarkResults.has(label)) {
      benchmarkResults.set(label, []);
    }
    benchmarkResults.get(label)!.push(stats);
    
    return stats;
  } catch (error) {
    watcher.process.kill();
    throw error;
  }
}

describe('svelte-check watch mode performance (with git worktrees)', () => {
  beforeAll(() => {
    // Ensure the worktree environment is set up
    if (!existsSync(MAIN_REPO)) {
      execSync('node scripts/setup-worktree-benchmark.js', { stdio: 'inherit' });
    }
  });

  bench('npm svelte-check@latest watch mode', async () => {
    const stats = await runWatchModeBenchmark(
      'node_modules/.bin/svelte-check',
      'npm-latest'
    );
    return stats.totalDuration;
  }, {
    iterations: 1,
    timeout: 300000 // 5 minutes per iteration
  });

  bench('our svelte-check with TSConfig excludes watch mode', async () => {
    const stats = await runWatchModeBenchmark(
      '../../language-tools/packages/svelte-check/bin/svelte-check',
      'custom-excludes'
    );
    return stats.totalDuration;
  }, {
    iterations: 1,
    timeout: 300000 // 5 minutes per iteration
  });

  afterAll(() => {
    console.log('\n\n=== BENCHMARK SUMMARY (WITH WORKTREES) ===\n');
    
    for (const [label, runs] of benchmarkResults.entries()) {
      const avgTotal = runs.reduce((a, b) => a + b.totalDuration, 0) / runs.length;
      const avgInitial = runs.reduce((a, b) => a + b.initialRunTime, 0) / runs.length;
      const avgBatch = runs.reduce((a, b) => a + b.averageBatchTime, 0) / runs.length;
      const medBatch = median(runs.map(r => r.medianBatchTime));
      
      console.log(`${label}:`);
      console.log(`  Average total time: ${(avgTotal / 1000).toFixed(2)}s`);
      console.log(`  Average initial run: ${(avgInitial / 1000).toFixed(2)}s`);
      console.log(`  Average batch time (10 changes): ${(avgBatch / 1000).toFixed(2)}s`);
      console.log(`  Median batch time: ${(medBatch / 1000).toFixed(2)}s`);
      console.log(`  Min batch time: ${(Math.min(...runs.map(r => r.minBatchTime)) / 1000).toFixed(2)}s`);
      console.log(`  Max batch time: ${(Math.max(...runs.map(r => r.maxBatchTime)) / 1000).toFixed(2)}s`);
      console.log();
    }
    
    // Calculate performance difference
    const npmStats = benchmarkResults.get('npm-latest');
    const customStats = benchmarkResults.get('custom-excludes');
    
    if (npmStats && customStats) {
      const npmAvgBatch = npmStats.reduce((a, b) => a + b.averageBatchTime, 0) / npmStats.length;
      const customAvgBatch = customStats.reduce((a, b) => a + b.averageBatchTime, 0) / customStats.length;
      const improvement = ((npmAvgBatch - customAvgBatch) / npmAvgBatch) * 100;
      
      console.log('=== PERFORMANCE COMPARISON ===');
      console.log(`Batch processing improvement: ${improvement.toFixed(1)}%`);
      console.log(`npm-latest: ${(npmAvgBatch / 1000).toFixed(2)}s per 10-file batch`);
      console.log(`custom-excludes: ${(customAvgBatch / 1000).toFixed(2)}s per 10-file batch`);
    }
  });
});