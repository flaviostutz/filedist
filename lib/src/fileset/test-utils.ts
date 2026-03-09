import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

import archiver from 'archiver';

/**
 * Creates a mock npm package with the given files, packages it as a tar.gz,
 * and installs it into tmpDir/node_modules using pnpm.
 *
 * @param name - Name of the package to create.
 * @param version - Version of the package.
 * @param files - Map of relative file paths to file contents.
 * @param tmpDir - Temporary directory to use as the project root.
 * @returns The path to the installed package in node_modules.
 */
export const installMockPackage = async (
  name: string,
  version: string,
  files: Record<string, string>,
  tmpDir: string,
): Promise<string> => {
  const packageDir = path.join(tmpDir, `${name}-source`);
  if (fs.existsSync(packageDir)) {
    fs.rmSync(packageDir, { recursive: true });
  }
  fs.mkdirSync(packageDir, { recursive: true });

  // Create package.json
  const packageJson = { name, version };
  fs.writeFileSync(path.join(packageDir, 'package.json'), JSON.stringify(packageJson));

  // Create other files
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(packageDir, filePath);
    const dir = path.dirname(fullPath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  // Create tar.gz file
  const tarGzPath = path.join(tmpDir, `${name.replaceAll('/', '-')}-${version}.tar.gz`);
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(tarGzPath);
    const archive = archiver('tar', { gzip: true });

    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(packageDir, 'package');
    archive.finalize().catch(reject);
  });

  // Create package.json in tmpDir if it doesn't exist so pnpm recognizes it as a project
  const tmpDirPkgJson = path.join(tmpDir, 'package.json');
  if (!fs.existsSync(tmpDirPkgJson)) {
    fs.writeFileSync(tmpDirPkgJson, JSON.stringify({ name: 'tmp-test-project', version: '1.0.0' }));
  }

  // Install the tar.gz package into tmpDir/node_modules
  execSync(`pnpm add ${tarGzPath}`, {
    cwd: tmpDir,
    stdio: 'pipe',
  });

  // Return the installed package path in node_modules
  return path.join(tmpDir, 'node_modules', name);
};
