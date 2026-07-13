export const STORAGE_KEY = 'qpm.gardenFilters.v1';
export const DIM_ALPHA = 0.1; // Barely visible

// Pre-compiled Tile-label matchers. Used in the hot traversal and cache paths;
// avoiding the double `.test()` + `.match()` roundtrip halves regex work per node.
export const TILE_LABEL_CAPTURE_RE = /^Tile \((\d+), (\d+)\)$/;
export const TILE_LABEL_TEST_RE = /^Tile \(\d+, \d+\)$/;
