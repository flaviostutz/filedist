import fs from 'node:fs';
import path from 'node:path';

import { ManagedFileMetadata } from '../types';
import { ensureDir, hashBuffer, shortenChecksum } from '../utils';

import { MARKER_FILE } from './constants';

/** Special path used for the self-checksum row at the end of a marker file. */
const SELF_CHECKSUM_PATH = '.';

/**
 * Read all managed file entries from a .filedist marker file.
 * Format: path|packageName|packageVersion|kind|checksum|mutable
 * Pipe is used as separator so file paths containing commas are handled safely.
 * mutable column: '1' = mutable, '0' or absent = not mutable.
 *
 * A trailing self-checksum row `.|<sha256hex>` covers all entry rows.
 * When present, integrity is verified and an error is thrown on mismatch.
 */
export async function readMarker(markerFilePath: string): Promise<ManagedFileMetadata[]> {
  if (!fs.existsSync(markerFilePath)) {
    return [];
  }
  const content = fs.readFileSync(markerFilePath, 'utf8');
  const lines = content.split('\n').filter((line) => line.trim() !== '');

  // Separate the self-checksum row (path === '.') from entry lines
  const checksumRow = lines.find((line) => line.split('|')[0] === SELF_CHECKSUM_PATH);
  const entryLines = lines.filter((line) => line.split('|')[0] !== SELF_CHECKSUM_PATH);

  if (checksumRow) {
    const storedHash = checksumRow.split('|')[1] ?? '';
    const expectedHash = shortenChecksum(hashBuffer(entryLines.join('\n') + '\n'));
    if (storedHash !== expectedHash) {
      throw new Error(
        `Marker integrity check failed: ${markerFilePath} may have been tampered with`,
      );
    }
  }

  return entryLines.map((line) => {
    const fields = line.split('|');
    return {
      path: fields[0] ?? '',
      packageName: fields[1] ?? '',
      packageVersion: fields[2] ?? '',
      kind: fields[3] === 'symlink' ? 'symlink' : 'file',
      checksum: fields[4] ?? '',
      mutable: fields[5] === '1',
    };
  });
}

/**
 * Write managed file entries to a .filedist marker file.
 * Format: path|packageName|packageVersion|kind|checksum|mutable
 * mutable column: '1' = mutable, '0' = not mutable.
 * Trailing columns up to (but not including) the last meaningful one are always written.
 * A self-checksum row `.|<sha256hex>` is appended after all entry rows.
 * Makes the file read-only after writing.
 */
export async function writeMarker(
  markerFilePath: string,
  entries: ManagedFileMetadata[],
): Promise<void> {
  ensureDir(path.dirname(markerFilePath));
  // Make writable if it already exists
  if (fs.existsSync(markerFilePath)) {
    fs.chmodSync(markerFilePath, 0o644);
  }
  if (entries.length === 0) {
    // Remove empty marker
    if (fs.existsSync(markerFilePath)) {
      fs.unlinkSync(markerFilePath);
    }
    return;
  }
  const rows = entries.map((e) => {
    const kindField = e.kind === 'symlink' ? 'symlink' : 'file';
    const checksumField = e.checksum;
    const mutableField = e.mutable ? '1' : '0';
    return `${e.path}|${e.packageName}|${e.packageVersion}|${kindField}|${checksumField}|${mutableField}`;
  });
  const entryContent = `${rows.join('\n')}\n`;
  const selfChecksum = shortenChecksum(hashBuffer(entryContent));
  fs.writeFileSync(
    markerFilePath,
    `${entryContent}${SELF_CHECKSUM_PATH}|${selfChecksum}\n`,
    'utf8',
  );
  fs.chmodSync(markerFilePath, 0o444);
}

/**
 * Returns the path of the .filedist marker file for a given output directory.
 */
export function markerPath(outputDir: string): string {
  return path.join(outputDir, MARKER_FILE);
}

/**
 * Read all managed file entries from an output directory's .filedist marker.
 */
export async function readOutputDirMarker(outputDir: string): Promise<ManagedFileMetadata[]> {
  return readMarker(markerPath(outputDir));
}
