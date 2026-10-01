import { fileURLToPath } from "node:url";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WGSL_SOURCE } from "../src/gpu/wgsl.js";

const repository_root = fileURLToPath(new URL("../", import.meta.url));

const scratch = await mkdtemp(join(tmpdir(), "folly-text-shader-"));
const shader_path = join(scratch, "text_effects.wgsl");
await writeFile(shader_path, WGSL_SOURCE);

try {
  const check = Bun.spawn(
    ["bunx", "vgpu", "check", shader_path, "--require-validation"],
    { cwd: repository_root, stdout: "pipe", stderr: "pipe" },
  );
  const [exit_code, stdout, stderr] = await Promise.all([
    check.exited,
    new Response(check.stdout).text(),
    new Response(check.stderr).text(),
  ]);
  if (exit_code !== 0) {
    throw new Error(stderr || stdout || "VGPU text shader validation failed.");
  }
  console.log(`text effect shader ok (${WGSL_SOURCE.length} chars)`);
} finally {
  await rm(scratch, { recursive: true, force: true });
}
