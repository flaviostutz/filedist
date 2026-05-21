// Public library exports for filedist v2

export { actionInstall } from './package/action-install';
export type { InstallOptions, InstallResult } from './package/action-install';

export {
  readLockfile,
  writeLockfile,
  buildLockfileData,
  computeLockfileChecksum,
  readManagedFilesForDir,
  writeManagedFilesForDir,
  outputDirKey,
} from './package/lockfile';
export type { LockfileData } from './package/lockfile';

export { actionCheck } from './package/action-check';
export type { CheckOptions, CheckSummary } from './package/action-check';

export { actionList } from './package/action-list';
export type { ListOptions } from './package/action-list';

export { resolveFiles } from './package/resolve-files';
export type { ResolveOptions } from './package/resolve-files';

export { calculateDiff } from './package/calculate-diff';

export { binpkg } from './cli/binpkg';

export type {
  FiledistConfig,
  FiledistExtractEntry,
  PackageConfig,
  SelectorConfig,
  OutputConfig,
  SymlinkConfig,
  ContentReplacementConfig,
  ManagedFileMetadata,
  ProgressEvent,
  ExtractionMap,
  CheckResult,
  ExecuteResult,
  ResolvedFile,
  DiffStatus,
  DiffEntry,
  DiffResult,
} from './types';
