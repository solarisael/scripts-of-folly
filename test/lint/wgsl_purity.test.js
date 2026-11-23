import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import cases from "./wgsl-module-bindings.yml";

const script = join(import.meta.dir, "../../scripts/check_wgsl_purity.js");
let directory;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), "folly-wgsl-")); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

function check(...entries) {
  return Bun.spawnSync([process.execPath, script, directory, ...entries]);
}

test("only named entries can own bindings; comments and longer names are not declarations", async () => {
  await Bun.write(join(directory, "nebula.wgsl"), "@group(0) @binding(0) var sky: texture_2d<f32>;");
  const entry = check("nebula.wgsl");
  expect(entry.stderr.toString()).toBe("");
  expect(entry.exitCode).toBe(0);
  for (const [i, source] of cases.valid.entries()) await Bun.write(join(directory, `part${i}.wgsl`), source);
  const result = check("nebula.wgsl");
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
});

test("check one shader family without exempting its whole directory", async () => {
  await Bun.write(join(directory, "sky_sight.wgsl"), cases.valid[0]);
  await Bun.write(join(directory, "sky_nebula.wgsl"), cases.invalid[1]);
  await Bun.write(join(directory, "fog.wgsl"), cases.invalid[1]);
  const result = check("--include", "sky_*.wgsl", "sky_nebula.wgsl");
  expect(result.stderr.toString()).toBe("");
  expect(result.exitCode).toBe(0);
});

for (const [i, source] of cases.invalid.entries()) {
  test(`reject module declaration ${i + 1} without a shader entry`, async () => {
    await Bun.write(join(directory, "sight.wgsl"), source);
    const result = check();
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toString()).toContain("sight.wgsl:");
  });
}

test("check the exported WGSL, not the surrounding JavaScript", async () => {
  await Bun.write(join(directory, "part.wgsl.js"), 'const attribute = "binding"; export const WGSL = `@${attribute}(1) var t: texture_2d<f32>;`;');
  const result = check();
  expect(result.exitCode).toBe(1);
  expect(result.stderr.toString()).toContain("part.wgsl.js (WGSL):1:");
});
