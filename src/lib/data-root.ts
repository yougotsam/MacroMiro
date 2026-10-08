/** Root for desk state files. Tests set MACROMIRO_DATA_DIR to a temp dir so they never touch production files. */
export const DATA_ROOT = process.env.MACROMIRO_DATA_DIR || "/workspace/data";
