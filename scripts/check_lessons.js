import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { WGSL_BINDING } from "./check_wgsl_purity.js";
import wgsl_cases from "../test/lint/wgsl-module-bindings.yml";

const root = join(import.meta.dir, "..");
const yaml = async (path) => Bun.YAML.parse(await Bun.file(join(root, path)).text());

async function contracts() {
  const rules = [];
  for (const file of new Bun.Glob("rules/*.yml").scanSync(root)) {
    const { id, language, rule } = await yaml(file);
    const cases = await yaml(`rules-tests/${id}.yml`);
    if (cases.id !== id) throw new Error(`${file}: wrong case ID ${cases.id}`);
    const patterns = (rule.any ?? [rule]).map((part) => part.pattern);
    if (!patterns.length || patterns.some((p) => typeof p !== "string" || !p))
      throw new Error(`${id}: use an AST pattern or a list of patterns under any.`);
    rules.push({ ...cases, language, languageKeys: ["javascript"], astCondition: patterns });
  }
  if (!rules.length) throw new Error("No ast-grep rules found.");
  return [...rules, { ...wgsl_cases, languageKeys: ["wgsl", "javascript"], condition: [WGSL_BINDING.source] }];
}

// Separate pattern IDs expose a silent alternative even if another pattern matches the same case.
function ast_matcher(language, patterns) {
  const rules = patterns.map((pattern, i) => JSON.stringify({
    id: `p${i}`, language, severity: "hint", rule: { pattern },
  })).join("\n---\n");
  const args = [join(root, "node_modules/.bin/ast-grep"), "scan", "--stdin", "--inline-rules", rules, "--json=compact"];
  return (snippet) => {
    const result = Bun.spawnSync(args, { stdin: Buffer.from(snippet) });
    if (result.exitCode !== 0) throw new Error(result.stderr.toString());
    return JSON.parse(result.stdout.toString()).map(({ ruleId }) => patterns[Number(ruleId.slice(1))]);
  };
}

async function check() {
  const packet = await Bun.stdin.json();
  if (packet.ok !== true || packet.type !== "coding" || !Array.isArray(packet.lessons))
    throw new Error("Expected JSON from lessons coding --tag folly-lint.");
  const rules = await contracts();
  const remaining = new Set(packet.lessons);
  let count = 0;
  let pattern_count = 0;
  for (const { id, invalid, language, languageKeys, astCondition = [], condition = [] } of rules) {
    const tag = `folly-lint:${id}`;
    const matches = packet.lessons.filter((row) => row.tags.includes(tag));
    if (matches.length !== 1) throw new Error(`${tag}: expected one lesson, got ${matches.length}.`);
    const [row] = matches;
    if (!remaining.delete(row) || !row.tags.includes("folly-lint"))
      throw new Error(`${tag}: invalid lesson tags.`);
    for (const [field, expected] of Object.entries({ astCondition, condition, languageKeys })) {
      if (!Array.isArray(row[field]) || !isDeepStrictEqual(row[field].toSorted(), expected.toSorted()))
        throw new Error(`${tag}: ${field} differs from the rule.`);
    }
    if (!invalid?.length) throw new Error(`${id}: no invalid cases.`);
    const patterns = language ? row.astCondition : row.condition;
    pattern_count += patterns.length;
    const silent = new Set(patterns);
    const match = language ? ast_matcher(language, patterns)
      : (snippet) => patterns.filter((pattern) => new RegExp(pattern).test(snippet));
    for (const [index, snippet] of invalid.entries()) {
      const hits = match(snippet);
      if (!hits.length) throw new Error(`${tag}: lesson ${row.id} missed invalid case ${index + 1}.`);
      for (const pattern of hits) silent.delete(pattern);
      count++;
    }
    if (silent.size) throw new Error(`${tag}: no invalid case triggered ${[...silent].join(", ")}.`);
  }
  if (remaining.size) throw new Error(`No matching rule for lesson(s) ${[...remaining].map((row) => row.id).join(", ")}.`);
  console.log(`${rules.length} lessons: ${pattern_count} patterns fired across ${count} invalid cases.`);
}

try {
  await check();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
