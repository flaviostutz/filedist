// Public package-layer API
export { actionInstall } from './action-install';
export type { InstallOptions, InstallResult } from './action-install';

export { actionCheck } from './action-check';
export type { CheckOptions, CheckSummary } from './action-check';

export { actionList } from './action-list';
export type { ListOptions } from './action-list';

export { actionRemove } from './action-remove';
export type { RemoveOptions, RemoveSummary } from './action-remove';

export { actionUpdate } from './action-update';
export type { UpdateOptions } from './action-update';

export { mergeSelectorConfig, mergeOutputConfig } from './config-merge';
