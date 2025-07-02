const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TEMP_DIR = 'temp-worktrees';
const REPO_URL = 'https://github.com/sveltejs/realworld.git';
const MAIN_REPO = path.join(TEMP_DIR, 'main-repo');
const WORKTREE_DIR = path.join(MAIN_REPO, 'worktrees', 'feature-branch');

console.log('Setting up worktree benchmark environment...');

// Clean up any existing temp directory
if (fs.existsSync(TEMP_DIR)) {
  console.log(`Removing existing ${TEMP_DIR} directory...`);
  execSync(`rm -rf ${TEMP_DIR}`, { stdio: 'inherit' });
}

// Create temp directory
fs.mkdirSync(TEMP_DIR, { recursive: true });

// Clone the repository with full history
console.log('Cloning SvelteKit RealWorld app with git history...');
execSync(`git clone ${REPO_URL} ${MAIN_REPO}`, { 
  stdio: 'inherit',
  cwd: process.cwd()
});

// Install dependencies
console.log('Installing dependencies...');
execSync('npm install', { 
  stdio: 'inherit',
  cwd: MAIN_REPO
});

// Install svelte-check
console.log('Installing svelte-check...');
execSync('npm install --save-dev svelte-check typescript', { 
  stdio: 'inherit',
  cwd: MAIN_REPO
});

// Create a worktree
console.log('Creating git worktree...');
execSync(`git worktree add ${WORKTREE_DIR} -b benchmark-test`, {
  stdio: 'inherit',
  cwd: MAIN_REPO
});

// Create or update tsconfig.json to exclude worktrees
const tsconfigPath = path.join(MAIN_REPO, 'tsconfig.json');
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
}

// Write updated tsconfig
fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2));

console.log('Worktree benchmark environment setup complete!');
console.log(`Main repository: ${MAIN_REPO}`);
console.log(`Worktree location: ${WORKTREE_DIR}`);