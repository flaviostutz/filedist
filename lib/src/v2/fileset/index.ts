// Public fileset-layer API
export { readMarker, writeMarker, markerPath, readOutputDirMarker } from './markers';
export { addToGitignore, removeFromGitignore, updateGitignoreSection } from './gitignore';
export { installedPackagePath, enumeratePackageFiles } from './package-files';
export { MARKER_FILE, DEFAULT_FILENAME_PATTERNS, GITIGNORE_FILE } from './constants';
