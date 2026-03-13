import { SelectorConfig, OutputConfig } from '../types';

/**
 * Merge two SelectorConfig objects across recursion levels.
 * - files: ANDed (intersection); when either is absent, use the other's list
 * - contentRegexes: ANDed (both must match)
 * - presets: NOT inherited (caller's presets not forwarded to dependency)
 * - upgrade: each level evaluated independently (not merged)
 */
export function mergeSelectorConfig(parent: SelectorConfig, child: SelectorConfig): SelectorConfig {
  const files =
    parent.files && child.files
      ? parent.files.filter((f) => (child.files ?? []).includes(f))
      : (parent.files ?? child.files);

  const contentRegexes =
    parent.contentRegexes && child.contentRegexes
      ? [...parent.contentRegexes, ...child.contentRegexes]
      : (parent.contentRegexes ?? child.contentRegexes);

  return {
    files,
    contentRegexes,
    presets: child.presets, // not inherited from parent
    upgrade: child.upgrade, // each level independent
  };
}

/**
 * Merge two OutputConfig objects for recursive extraction.
 * - force, keepExisting, gitignore, managed, dryRun: caller value overrides child
 * - path: concatenated (parent/child)
 * - symlinks: appended (parent + child)
 * - contentReplacements: appended (parent + child)
 */
export function mergeOutputConfig(caller: OutputConfig, child: OutputConfig): OutputConfig {
  return {
    path: `${caller.path}/${child.path}`.replaceAll(/\/+/g, '/'),
    force: caller.force ?? child.force,
    keepExisting: caller.keepExisting ?? child.keepExisting,
    gitignore: caller.gitignore ?? child.gitignore,
    managed: caller.managed ?? child.managed,
    dryRun: caller.dryRun ?? child.dryRun,
    symlinks: [...(caller.symlinks ?? []), ...(child.symlinks ?? [])],
    contentReplacements: [
      ...(caller.contentReplacements ?? []),
      ...(child.contentReplacements ?? []),
    ],
  };
}
