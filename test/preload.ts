/** bun test preload: every test writes into a fresh temp dir, never /workspace/data. */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "macromiro-test-"));
process.env.MACROMIRO_DATA_DIR = join(root, "data");
process.env.DESK_DATA_DIR = join(root, "desk");
process.env.MIROFISH_DATA_DIR ??= join(root, "mirofish");
