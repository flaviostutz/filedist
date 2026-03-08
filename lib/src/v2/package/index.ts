// Public package-layer API
export { actionExtract } from './action-extract';
export type { ExtractOptions, ExtractResult } from './action-extract';

export { actionCheck } from './action-check';
export type { CheckOptions, CheckSummary } from './action-check';

export { actionList } from './action-list';
export type { ListOptions } from './action-list';

export { actionPurge } from './action-purge';
export type { PurgeOptions, PurgeSummary } from './action-purge';

export { run } from './runner';
export {
  parseArgv,
  buildEntriesFromArgv,
  filterEntriesByPresets,
  applyArgvOverrides,
} from './argv';
export type { ParsedArgv } from './argv';
export { mergeSelectorConfig, mergeOutputConfig } from './config-merge';
