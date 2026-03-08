/**
 * Internal parsed representation of an npm package specifier.
 */
export type PackageConfig = {
  /** npm package name (e.g. "my-pkg" or "@scope/my-pkg") */
  name: string;
  /** Semver range constraint. Absent means "latest". */
  version?: string;
};

/**
 * Controls which files are selected from a package and install behaviour.
 */
export type SelectorConfig = {
  /**
   * Glob patterns; files must match at least one.
   * Default: DEFAULT_FILENAME_PATTERNS (excludes package.json, bin/**, README.md, node_modules/**)
   */
  files?: string[];
  /**
   * Regex strings; files must match at least one. Binary files always skip regex check.
   */
  contentRegexes?: string[];
  /**
   * Tags this entry for --presets CLI filtering. Not forwarded to dependency packages.
   */
  presets?: string[];
  /**
   * Force fresh package install even if a satisfying version is installed.
   */
  upgrade?: boolean;
};

/**
 * Controls where and how extracted files are written.
 */
export type OutputConfig = {
  /**
   * Output directory relative to cwd. Concatenated across recursion levels.
   */
  path: string;
  /**
   * Overwrite existing unmanaged files. Overridden by --force and --keep-existing.
   */
  force?: boolean;
  /**
   * Skip files that already exist; create missing ones. Cannot combine with force.
   */
  keepExisting?: boolean;
  /**
   * Create/update .gitignore alongside each .npmdata marker.
   */
  gitignore?: boolean;
  /**
   * Write without .npmdata marker, no gitignore update, no read-only. Existing files skipped.
   * Takes precedence over force.
   */
  unmanaged?: boolean;
  /**
   * Report what would change; no disk writes.
   */
  dryRun?: boolean;
  /**
   * Post-extract symlink operations. Appended across recursion levels.
   */
  symlinks?: SymlinkConfig[];
  /**
   * Post-extract content replacements. Appended across recursion levels.
   */
  contentReplacements?: ContentReplacementConfig[];
};

/**
 * Controls runtime output verbosity.
 */
export type ExecutionConfig = {
  /** Suppress per-file output; print only final summary line. */
  silent?: boolean;
  /** Print detailed step information. */
  verbose?: boolean;
};

/**
 * Defines one post-extract symlink operation.
 */
export type SymlinkConfig = {
  /** Glob relative to outputDir. Matching files/dirs get symlinked into `target`. */
  source: string;
  /** Directory where symlinks are created, relative to outputDir. Supports ../ paths. */
  target: string;
};

/**
 * Defines one post-extract content replacement operation.
 */
export type ContentReplacementConfig = {
  /** Glob relative to cwd selecting workspace files to modify. */
  files: string;
  /** Regex string; all non-overlapping occurrences replaced (global flag applied). */
  match: string;
  /** Replacement string; may contain back-references ($1, $2). */
  replace: string;
};

/**
 * One entry in the npmdata.sets array. Represents a single extraction target.
 */
export type NpmdataExtractEntry = {
  /** Flat package spec string ("my-pkg@^1.2.3"). Parsed to PackageConfig internally. */
  package: string;
  /** Where/how to write files. */
  output: OutputConfig;
  /** Which files to select and install options. */
  selector?: SelectorConfig;
  /** Suppress per-file output. Root-level (not nested). */
  silent?: boolean;
  /** Print detailed step information. Root-level (not nested). */
  verbose?: boolean;
};

/**
 * Top-level structure stored under npmdata key in package.json or in any cosmiconfig source.
 */
export type NpmdataConfig = {
  /** All extraction entries. */
  sets: NpmdataExtractEntry[];
  /**
   * Shell command run after successful extract (not during --dry-run).
   * Executed in process.cwd(). Full argv appended as arguments.
   */
  postExtractScript?: string;
};

/**
 * A single file operation in the diff/execute pipeline.
 */
export type FileOperation = {
  relPath: string;
  sourcePath: string;
  destPath: string;
  hash: string;
};

/**
 * A file skipped during extraction with the reason.
 */
export type SkippedFile = {
  relPath: string;
  reason: 'conflict' | 'keep-existing' | 'unmanaged';
};

/**
 * An unmanaged file in outputDir that blocks extraction.
 */
export type ConflictFile = {
  relPath: string;
  /** Set when file is managed by a different package. */
  existingOwner?: string;
};

/**
 * Internal read-only structure produced by fileset/diff.ts. Not persisted.
 */
export type ExtractionMap = {
  /** Files present in package source but absent from outputDir. */
  toAdd: FileOperation[];
  /** Files whose hash differs between package source and outputDir. */
  toModify: FileOperation[];
  /** Relative paths of managed files no longer present in filtered package source. */
  toDelete: string[];
  /** Files skipped with reason. */
  toSkip: SkippedFile[];
  /** Unmanaged files in outputDir that block extraction. */
  conflicts: ConflictFile[];
};

/**
 * One row in a .npmdata CSV marker file.
 * CSV format (preserved from v1): path,packageName,packageVersion — one row per file, no header.
 */
export type ManagedFileMetadata = {
  /** Relative path from marker file directory. */
  path: string;
  /** Source npm package name. */
  packageName: string;
  /** Installed version at extraction time. */
  packageVersion: string;
};

/**
 * Event emitted by extract/check/purge for UI progress reporting.
 */
export type ProgressEvent =
  | { type: 'package-start'; packageName: string; packageVersion: string }
  | { type: 'package-end'; packageName: string; packageVersion: string }
  | { type: 'file-added'; packageName: string; file: string }
  | { type: 'file-modified'; packageName: string; file: string }
  | { type: 'file-deleted'; packageName: string; file: string }
  | { type: 'file-skipped'; packageName: string; file: string };

/**
 * Result of a check operation for a single fileset.
 */
export type CheckResult = {
  /** Files in .npmdata marker but absent from output dir. */
  missing: string[];
  /** Files whose content hash differs from package source. */
  modified: string[];
  /** Files in filtered package source but never extracted. */
  extra: string[];
};

/**
 * Result of purging one fileset.
 */
export type PurgeResult = {
  /** Number of files deleted. */
  deleted: number;
  /** Number of symlinks removed. */
  symlinksRemoved: number;
  /** Number of empty dirs removed. */
  dirsRemoved: number;
};

/**
 * Result of executing an ExtractionMap.
 */
export type ExecuteResult = {
  /** Paths of newly created files (for rollback purposes). */
  newlyCreated: string[];
  /** Number of files added. */
  added: number;
  /** Number of files modified. */
  modified: number;
  /** Number of files deleted. */
  deleted: number;
  /** Number of files skipped. */
  skipped: number;
};
