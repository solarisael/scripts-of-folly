// Generates src/terminal/terminal_shader.js: the prepared vgpu shader of
// terminal.wgsl with its imports resolved (see ./prepared_shader.js). vgpu
// checks the WGSL on a WebGPU device first.
//   bun scripts/build_terminal_shader.js          write it
//   bun scripts/build_terminal_shader.js --check  fail when it drifted
import { fileURLToPath } from "node:url";
import { prepared_module } from "./prepared_shader.js";

const check_only = process.argv.includes("--check");
const repository_root = fileURLToPath(new URL("../", import.meta.url));
const shader_path = fileURLToPath(
  new URL("../src/terminal/terminal.wgsl", import.meta.url),
);
const module_path = fileURLToPath(
  new URL("../src/terminal/terminal_shader.js", import.meta.url),
);

const check = Bun.spawn(
  ["bunx", "vgpu", "check", shader_path, "--require-validation"],
  {
    cwd: repository_root,
    stdout: "pipe",
    stderr: "pipe",
  },
);
const [exit_code, stdout, stderr] = await Promise.all([
  check.exited,
  new Response(check.stdout).text(),
  new Response(check.stderr).text(),
]);
if (exit_code !== 0) {
  throw new Error(stderr || stdout || "VGPU shader compilation failed.");
}

const result = JSON.parse(stdout);
if (typeof result.wgsl !== "string" || !result.wgsl) {
  throw new Error("VGPU did not return resolved Terminal WGSL.");
}

const resolved_source = result.wgsl.replace(
  /^\/\/ vgsl-module:.*(?:\r?\n)?/gmu,
  "",
);
const module_source = prepared_module(
  "// Generated from terminal.wgsl by bun run build:terminal-shader.",
  resolved_source,
  "src/terminal/terminal.wgsl",
);

if (!check_only) {
  await Bun.write(module_path, module_source);
} else {
  // The resolver names imported declarations by a hash of their absolute
  // path, so the comparison leaves out those hashes and the checksum.
  const comparable = (text) =>
    text
      .replace(/_vgsl_[0-9a-f]{8,16}__/g, "_vgsl__")
      .replace(/"sourceChecksum": "[^"]*"/, "");
  const committed = await Bun.file(module_path)
    .text()
    .catch(() => "");
  if (comparable(committed) !== comparable(module_source)) {
    console.error(
      "terminal_shader.js drifted from terminal.wgsl; run bun run build:terminal-shader.",
    );
    process.exitCode = 1;
  } else {
    console.log("terminal shader ok");
  }
}
