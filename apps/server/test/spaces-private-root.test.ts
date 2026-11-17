import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildFolders } from "../../../scripts/native-package";
import { SPACES_PRIVATE_ROOT } from "../src/spaces-private-root";

test("source runs keep the fork's private directory", () => {
  expect(SPACES_PRIVATE_ROOT).toBe(path.resolve(import.meta.dir, "../../../.rheo"));
});

test("a local release rejects a relative private directory before building", async () => {
  await expect(buildFolders("unused-output", "unused-version", "relative/.rheo")).rejects.toThrow("must be absolute");
});

test("a frozen local bundle keeps the explicitly pinned private directory", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "spaces-private-root-"));
  try {
    const pinned = path.join(directory, "original-fork", ".rheo");
    const built = await Bun.build({
      entrypoints: [path.resolve(import.meta.dir, "../src/spaces-private-root.ts")],
      outdir: path.join(directory, "release", "server", "lib"),
      target: "bun",
      define: { SPACES_BUILD_PRIVATE_ROOT: JSON.stringify(pinned) },
    });
    expect(built.success).toBe(true);
    const output = built.outputs[0];
    if (!output) throw new Error("The private-root bundle is missing");
    const bundled = await import(output.path);
    expect(bundled.SPACES_PRIVATE_ROOT).toBe(pinned);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
