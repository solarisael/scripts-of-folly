import { join, normalize } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

export const WGSL_BINDING = /@\s*(?:group|binding)\b|\bvar\s*<\s*uniform\b/;

function without_comments(source) {
  const comment = /\/\/[^\r\n]*|\/\*/g;
  const delimiter = /\/\*|\*\//g;
  let code = "";
  let start = 0;
  for (let match; (match = comment.exec(source)); start = comment.lastIndex) {
    code += source.slice(start, match.index);
    if (match[0] === "/*") {
      delimiter.lastIndex = comment.lastIndex;
      let depth = 1;
      while (depth) {
        const next = delimiter.exec(source);
        if (!next) throw new Error("Unclosed WGSL block comment.");
        depth += next[0] === "/*" ? 1 : -1;
      }
      comment.lastIndex = delimiter.lastIndex;
    }
    // Keep line numbers and a gap between tokens on either side of a comment.
    code += source.slice(match.index, comment.lastIndex).replace(/[^\r\n]/g, " ");
  }
  return code + source.slice(start);
}

async function shader_strings(file) {
  if (file.endsWith(".wgsl")) return [[file, await Bun.file(file).text()]];
  // Check the strings the shader build receives, including JS interpolation.
  const module = await import(pathToFileURL(file).href);
  const strings = Object.entries(module)
    .filter(([, source]) => typeof source === "string")
    .map(([name, source]) => [`${file} (${name})`, source]);
  if (!strings.length) throw new Error(`${file}: no exported WGSL string.`);
  return strings;
}

async function check(directory, entries, include) {
  const unseen = new Set(entries.map((file) => normalize(file)));
  const shaders = new Bun.Glob("**/{*.wgsl,*.wgsl.js,*_wgsl.js,wgsl.js}");
  const family = include && new Bun.Glob(include);
  let modules = 0;
  let errors = 0;
  for await (const path of shaders.scan({ cwd: directory })) {
    if (family && !family.match(path)) continue;
    if (unseen.delete(path)) continue;
    modules++;
    for (const [label, source] of await shader_strings(join(directory, path))) {
      const code = without_comments(source);
      const match = WGSL_BINDING.exec(code);
      if (!match) continue;
      const line = code.slice(0, match.index).split(/\r\n?|\n/).length;
      console.error(`${label}:${line}: declare bindings only in an entry shader.`);
      errors++;
    }
  }
  if (unseen.size) throw new Error(`Unknown entry shader: ${[...unseen].join(", ")}`);
  if (!modules && !entries.length) throw new Error(`No matching WGSL files in ${directory}.`);
  console.log(`WGSL modules: ${modules}. Entry shaders: ${entries.length}. Errors: ${errors}.`);
  return errors ? 1 : 0;
}

if (import.meta.main) {
  try {
    const { positionals: [directory, ...entries], values } = parseArgs({
      options: { include: { type: "string" } },
      allowPositionals: true,
    });
    if (!directory) throw new Error("Usage: bun check_wgsl_purity.js [--include GLOB] DIRECTORY [ENTRY ...]");
    process.exitCode = await check(directory, entries, values.include);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
