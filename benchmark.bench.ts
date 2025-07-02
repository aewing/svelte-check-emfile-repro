import { bench, describe, expect, afterAll } from 'vitest';
import { spawn } from 'child_process';

interface SvelteCheckResult {
  duration: number;
  stdout: string;
}

/**
 * Run svelte-check and measure time to completion
 */
function runSvelteCheck(command: string): Promise<SvelteCheckResult> {
  const startTime = Date.now();
  
  return new Promise((resolve, reject) => {
    const child = spawn('bash', ['-c', command], {
      cwd: './temp',
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      const duration = Date.now() - startTime;
      
      if (code !== 0 && !stdout.includes('svelte-check found')) {
        console.error('Command failed:', command);
        console.error('stderr:', stderr);
        reject(new Error(`Command failed with code ${code}`));
      } else {
        resolve({ duration, stdout });
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

describe('svelte-check performance', () => {
  let latestOutput: string | null = null;
  let customOutput: string | null = null;

  bench('npm svelte-check@latest', async () => {
    const result = await runSvelteCheck('npx svelte-check@latest');
    if (!latestOutput) {
      latestOutput = result.stdout;
    }
    return result.duration;
  }, {
    iterations: 10
  });

  bench('our svelte-check with TSConfig excludes', async () => {
    const result = await runSvelteCheck('../../language-tools/packages/svelte-check/bin/svelte-check');
    if (!customOutput) {
      customOutput = result.stdout;
    }
    return result.duration;
  }, {
    iterations: 10
  });

  // After all benchmarks complete, assert outputs are the same
  afterAll(() => {
    if (latestOutput && customOutput) {
      console.log('\n=== Comparing svelte-check outputs ===');
      if (latestOutput === customOutput) {
        console.log('✅ Outputs match exactly!');
      } else {
        console.log('❌ Outputs differ!');
        console.log('\n--- npm svelte-check@latest output ---');
        console.log(latestOutput);
        console.log('\n--- custom svelte-check output ---');
        console.log(customOutput);
        expect(latestOutput).toBe(customOutput);
      }
    }
  });
});
