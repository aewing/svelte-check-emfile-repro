#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('Generating test files to reproduce EMFILE issue...');

// Create directories that should be excluded by TSConfig
const excludedDirs = [
  'dist',
  'build', 
  '.svelte-kit',
  'coverage',
  'large-excluded',
  'node_modules_mock',
  'temp-files',
  'worktrees'
];

// Create a few valid files that should be included
const srcDir = 'src';
if (!fs.existsSync(srcDir)) {
  fs.mkdirSync(srcDir, { recursive: true });
}

// Create valid source files
fs.writeFileSync(path.join(srcDir, 'App.svelte'), `<script lang="ts">
  export let name: string = 'world';
</script>

<h1>Hello {name}!</h1>`);

fs.writeFileSync(path.join(srcDir, 'main.ts'), `import App from './App.svelte';

const app = new App({
  target: document.body,
  props: { name: 'Svelte' }
});

export default app;`);

fs.writeFileSync(path.join(srcDir, 'utils.ts'), `export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}`);

// Now create many files in directories that should be EXCLUDED by TSConfig
excludedDirs.forEach(dir => {
  console.log(`Creating files in excluded directory: ${dir}`);
  
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // Create different file types that svelte-check watches
  const fileTypes = [
    { ext: 'ts', content: (i) => `export const value${i} = ${i};\nexport type Type${i} = { id: ${i} };` },
    { ext: 'js', content: (i) => `export const value${i} = ${i};\nexport function func${i}() { return ${i}; }` },
    { ext: 'svelte', content: (i) => `<script>\n  export let prop${i} = ${i};\n</script>\n<p>Component ${i}: {prop${i}}</p>` },
    { ext: 'd.ts', content: (i) => `declare const global${i}: ${i};\nexport = global${i};` }
  ];
  
  // Create enough files to trigger EMFILE with low ulimit
  const filesPerType = dir === 'large-excluded' ? 200 : 50; // Simple, focused test
  
  fileTypes.forEach(({ ext, content }) => {
    for (let i = 1; i <= filesPerType; i++) {
      const fileName = `file${i}.${ext}`;
      const filePath = path.join(dir, fileName);
      fs.writeFileSync(filePath, content(i));
    }
  });
  
  // Create a few nested subdirectories 
  for (let subDir = 1; subDir <= 3; subDir++) {
    const subDirPath = path.join(dir, `subdir${subDir}`);
    if (!fs.existsSync(subDirPath)) {
      fs.mkdirSync(subDirPath, { recursive: true });
    }
    
    for (let i = 1; i <= 20; i++) {
      fs.writeFileSync(
        path.join(subDirPath, `nested${i}.ts`), 
        `export const nested${subDir}_${i} = ${subDir * i};`
      );
    }
  }
});

// Count total files created
let totalFiles = 0;
function countFiles(dir) {
  if (!fs.existsSync(dir)) return 0;
  
  const items = fs.readdirSync(dir);
  let count = 0;
  
  items.forEach(item => {
    const fullPath = path.join(dir, item);
    const stats = fs.statSync(fullPath);
    
    if (stats.isDirectory()) {
      count += countFiles(fullPath);
    } else {
      count++;
    }
  });
  
  return count;
}

excludedDirs.forEach(dir => {
  const count = countFiles(dir);
  totalFiles += count;
  console.log(`  ${dir}: ${count} files`);
});

console.log(`\nTotal files created in EXCLUDED directories: ${totalFiles}`);
console.log(`Files in INCLUDED src directory: ${countFiles('src')}`);
console.log(`\nReproduction setup complete!`);
console.log(`\nNow run: npm run test-emfile`);
console.log(`Expected: svelte-check should ignore excluded files, but it will likely watch them all and hit EMFILE limits.`);