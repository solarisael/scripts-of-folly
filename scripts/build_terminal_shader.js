import { fileURLToPath } from "node:url";

const repository_root = fileURLToPath(new URL("../", import.meta.url));
const shader_path = fileURLToPath(
  new URL("../src/terminal/terminal.wgsl", import.meta.url),
);
const module_path = fileURLToPath(
  new URL("../src/terminal/terminal_shader.js", import.meta.url),
);

const process = Bun.spawn(
  ["bunx", "vgpu", "check", shader_path, "--require-validation"],
  {
    cwd: repository_root,
    stdout: "pipe",
    stderr: "pipe",
  },
);
const [exit_code, stdout, stderr] = await Promise.all([
  process.exited,
  new Response(process.stdout).text(),
  new Response(process.stderr).text(),
]);
if (exit_code !== 0) {
  throw new Error(stderr || stdout || "VGPU shader compilation failed.");
}

const result = JSON.parse(stdout);
if (typeof result.wgsl !== "string" || !result.wgsl) {
  throw new Error("VGPU did not return resolved Terminal WGSL.");
}

const resolved_source = result.wgsl
  .replace(/^\/\/ vgsl-module:.*(?:\r?\n)?/gmu, "")
  .replaceAll("`", "\\`")
  .replaceAll("${", "\\${");
const module_source = `// Generated from terminal.wgsl by bun run build:terminal-shader.\nconst terminal_source = String.raw\`${resolved_source}\`;\n\nexport default terminal_source;\n`;
await Bun.write(module_path, module_source);
