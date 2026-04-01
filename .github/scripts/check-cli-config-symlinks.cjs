const fs = require('node:fs');
const path = require('node:path');

const exampleDir = process.cwd();
const outputDir = path.join(exampleDir, 'output');
const linkDir = path.join(outputDir, 'data-symlink');

const expectedFiles = [
  path.join(outputDir, 'docs', 'guide.md'),
  path.join(outputDir, 'data', 'users-dataset', 'user1.json'),
];

for (const filePath of expectedFiles) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Expected exported file to exist: ${filePath}`);
  }

  const stat = fs.lstatSync(filePath);
  if (!stat.isFile()) {
    throw new Error(`Expected exported regular file at: ${filePath}`);
  }
}

const expectedLinks = [
  ['users-dataset', path.join(outputDir, 'data', 'users-dataset')],
  ['user1.json', path.join(outputDir, 'data', 'users-dataset', 'user1.json')],
];

for (const [linkName, expectedTarget] of expectedLinks) {
  const linkPath = path.join(linkDir, linkName);
  const stat = fs.lstatSync(linkPath);
  if (!stat.isSymbolicLink()) {
    throw new Error(`Expected symbolic link to exist: ${linkPath}`);
  }

  const actualTarget = path.resolve(linkDir, fs.readlinkSync(linkPath));
  if (actualTarget !== expectedTarget) {
    throw new Error(
      `Expected ${linkPath} to point to ${expectedTarget}, but got ${actualTarget}`,
    );
  }
}

console.log('CLI config symlink extraction check passed');