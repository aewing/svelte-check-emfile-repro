const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEMP_DIR = 'temp';
const REPO_URL = 'https://github.com/sveltejs/realworld.git';

// Define all our test environments
const environments = {
  'no-worktrees': {
    dir: path.join(TEMP_DIR, 'no-worktrees'),
    description: 'Standard RealWorld app without worktrees',
    setupWorktrees: false
  },
  'with-worktrees': {
    dir: path.join(TEMP_DIR, 'with-worktrees'),
    description: 'RealWorld app with git worktrees',
    setupWorktrees: true
  }
};

function log(message) {
  console.log(`[SETUP] ${message}`);
}

function dirExists(dirPath) {
  return fs.existsSync(dirPath) && fs.statSync(dirPath).isDirectory();
}

function hasNodeModules(dirPath) {
  return fs.existsSync(path.join(dirPath, 'node_modules'));
}

function hasSvelteCheck(dirPath) {
  return fs.existsSync(path.join(dirPath, 'node_modules', '.bin', 'svelte-check'));
}

function isValidEnvironment(envPath) {
  return dirExists(envPath) && 
         fs.existsSync(path.join(envPath, 'package.json')) &&
         fs.existsSync(path.join(envPath, 'src')) &&
         hasNodeModules(envPath) &&
         hasSvelteCheck(envPath);
}

function setupBaseEnvironment(envPath) {
  log(`Setting up base environment at ${envPath}`);
  
  // Create directory if it doesn't exist
  if (!dirExists(envPath)) {
    fs.mkdirSync(envPath, { recursive: true });
  }
  
  // Check if we already have a valid setup
  if (isValidEnvironment(envPath)) {
    log(`Environment at ${envPath} already exists and is valid`);
    return;
  }
  
  // Clean and recreate if invalid
  if (dirExists(envPath)) {
    log(`Cleaning invalid environment at ${envPath}`);
    execSync(`rm -rf ${envPath}`, { stdio: 'inherit' });
    fs.mkdirSync(envPath, { recursive: true });
  }
  
  // Clone or degit the repository
  log('Downloading SvelteKit RealWorld app...');
  try {
    // Try degit first (faster, no git history)
    execSync(`npx degit sveltejs/realworld ${envPath}`, { 
      stdio: 'pipe' // Hide output unless there's an error
    });
  } catch (error) {
    log('Degit failed, trying git clone...');
    execSync(`git clone --depth 1 ${REPO_URL} ${envPath}`, {
      stdio: 'inherit'
    });
  }
  
  // Install dependencies
  log('Installing dependencies...');
  execSync('npm install', { 
    stdio: 'inherit',
    cwd: envPath
  });
  
  // Install svelte-check if not present
  if (!hasSvelteCheck(envPath)) {
    log('Installing svelte-check...');
    execSync('npm install --save-dev svelte-check typescript', { 
      stdio: 'inherit',
      cwd: envPath
    });
  }
}

function setupWorktrees(envPath) {
  log(`Setting up git worktrees in ${envPath}`);
  
  // Ensure we have a proper git repo (degit doesn't include .git)
  if (!fs.existsSync(path.join(envPath, '.git'))) {
    log('Initializing git repository...');
    execSync('git init', { cwd: envPath, stdio: 'inherit' });
    execSync('git add .', { cwd: envPath, stdio: 'inherit' });
    execSync('git commit -m "Initial commit"', { cwd: envPath, stdio: 'inherit' });
  }
  
  const worktreeDir = path.join(envPath, 'worktrees', 'feature-branch');
  
  // Create worktree if it doesn't exist
  if (!fs.existsSync(worktreeDir)) {
    log('Creating git worktree...');
    execSync(`git worktree add ${worktreeDir} -b benchmark-test 2>/dev/null || git worktree add ${worktreeDir} benchmark-test`, {
      cwd: envPath,
      stdio: 'inherit'
    });
  }
  
  // Update tsconfig to exclude worktrees
  const tsconfigPath = path.join(envPath, 'tsconfig.json');
  let tsconfig;
  
  if (fs.existsSync(tsconfigPath)) {
    tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf-8'));
  } else {
    // Create a basic tsconfig if it doesn't exist
    tsconfig = {
      extends: './.svelte-kit/tsconfig.json',
      compilerOptions: {
        allowJs: true,
        checkJs: true,
        esModuleInterop: true,
        forceConsistentCasingInFileNames: true,
        resolveJsonModule: true,
        skipLibCheck: true,
        sourceMap: true,
        strict: false
      }
    };
  }
  
  // Add exclude for worktrees
  if (!tsconfig.exclude) {
    tsconfig.exclude = [];
  }
  if (!tsconfig.exclude.includes('worktrees/**')) {
    tsconfig.exclude.push('worktrees/**');
    
    // Write updated tsconfig
    fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));
    log('Updated tsconfig.json to exclude worktrees');
  }
}

function setupEnvironments() {
  log('Setting up benchmark environments...');
  
  // Create temp directory
  if (!dirExists(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
  
  // Setup each environment
  for (const [name, config] of Object.entries(environments)) {
    log(`\n=== Setting up ${name} environment ===`);
    log(config.description);
    
    setupBaseEnvironment(config.dir);
    
    if (config.setupWorktrees) {
      setupWorktrees(config.dir);
    }
    
    log(`✅ ${name} environment ready`);
  }
  
  log('\n=== All environments ready! ===');
  log(`No worktrees: ${environments['no-worktrees'].dir}`);
  log(`With worktrees: ${environments['with-worktrees'].dir}`);
}

// Check if we're being run directly
if (require.main === module) {
  setupEnvironments();
}

module.exports = {
  setupEnvironments,
  environments,
  TEMP_DIR
};