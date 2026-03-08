// Public library exports for npmdata v2

export { actionExtract } from './package/action-extract';
export type { ExtractOptions, ExtractResult } from './package/action-extract';

export { actionCheck } from './package/action-check';
export type { CheckOptions, CheckSummary } from './package/action-check';

export { actionList } from './package/action-list';
export type { ListOptions } from './package/action-list';

export { actionPurge } from './package/action-purge';
export type { PurgeOptions, PurgeSummary } from './package/action-purge';

export { run } from './package/runner';

export type {
  NpmdataConfig,
  NpmdataExtractEntry,
  PackageConfig,
  SelectorConfig,
  OutputConfig,
  SymlinkConfig,
  ContentReplacementConfig,
  ManagedFileMetadata,
  ProgressEvent,
  ExtractionMap,
  CheckResult,
  PurgeResult,
  ExecuteResult,
} from './types';
