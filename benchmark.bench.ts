import { bench, describe } from 'vitest';
import { spawn } from 'child_process';

/**
 * Run svelte-check and measure time to completion
 */
function runSvelteCheck(command: string): Promise<number> {
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
        resolve(duration);
      }
    });

    child.on('error', (error) => {
      reject(error);
    });
  });
}

describe('svelte-check performance', () => {
  bench('npm svelte-check@latest', async () => {
    await runSvelteCheck('npx svelte-check@latest');
  }, {
    iterations: 100
  });

  bench('our svelte-check with TSConfig excludes', async () => {
    await runSvelteCheck('../../packages/svelte-check/bin/svelte-check');
  }, {
    iterations: 100
  });
});