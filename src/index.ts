#!/usr/bin/env node

const pkg = require('../package.json');

const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  console.log(`${pkg.name} v${pkg.version}`);
  process.exit(0);
}

console.log(`${pkg.name} v${pkg.version}`);
