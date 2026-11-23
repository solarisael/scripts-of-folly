# Lint checks

Use Bun 1.4.4. Run these commands from the repository root:

```sh
bun install --frozen-lockfile
bun run lint
bun run wgsl:check
bun test
bun run glsl:check
```

The last command needs naga-cli 30.0.1 on `PATH`. CI runs the same checks.

## What the rules check

- Only `src/gpu/open_gpu.js` can use the `requestAdapter` and `requestDevice` properties directly.
- Only `src/webgl2/context.js` can call `getContext` with the literal `webgl2` as its first argument.
- JavaScript shader sources cannot use the `document` and `window` globals. The shader build runs without a DOM.

The JavaScript rules check dot access, including optional chains. They do not resolve aliases or computed properties.
Folly still has frame requests outside `frame_loop.js`. The terminal still opens its own GPU.
The compositor does not yet take a plane draw callback. The lint does not certify these planned boundaries.

## WGSL modules

The check finds `*.wgsl`, `*.wgsl.js`, `*_wgsl.js`, and `wgsl.js` below the selected directory.
It treats each file as a module unless its path occurs in the entry list.
This path convention protects a new module without a marker or a change to the check.
A stage attribute does not exempt a module.

Only an entry shader can declare `@group`, `@binding`, or `var<uniform>`.
The check ignores line comments and nested block comments.
It imports JavaScript shader sources to check their exported strings after interpolation.
Run the check only on trusted sources.
The check does not detect reads of bindings from an entry shader. Some Folly effects still read these values.

The `wgsl:check` command in `package.json` lists Folly's entry paths relative to `src`.
A host can select one shader family from a shared directory:

```sh
bun node_modules/scripts-of-folly/scripts/check_wgsl_purity.js \
  --include 'sky_*.wgsl' src/shaders sky_main.wgsl
```

Replace the glob and entry paths with those of the host. A missing entry or an empty file selection fails the check.

## Add a JavaScript rule

1. Add `rules/ID.yml` with a JavaScript `pattern` or a list of patterns under `any`.
2. Set the source paths, severity `error`, and a message that names the owner.
3. Add `rules-tests/ID.yml` with the same ID and both `valid` and `invalid` cases.
4. Include an invalid case for each pattern. Include a similar valid case that must not match.
5. Run `node_modules/.bin/sg test --filter ID --update-all`. Inspect the snapshot before you commit it.
6. Run `bun run lint`. For WGSL, add cases to `test/lint/wgsl-module-bindings.yml` instead.

## Check lesson patterns on the tower

Public CI does not need House access. The tower reads the current coding lessons from the House registry:

```sh
set -o pipefail
lessons coding --tag folly-lint --limit 100 | bun scripts/check_lessons.js
```

Use the tags `folly-lint` and `folly-lint:ID` on each lesson.
Copy the JavaScript rule patterns into `astCondition`. Use `javascript` for `languageKeys`.
For WGSL, copy `WGSL_BINDING.source` into `condition`. Use `wgsl` and `javascript` for `languageKeys`.

The check rejects missing, duplicate, and extra lessons. It compares their triggers and language keys with the rules.
Each invalid case must trigger a lesson. Each pattern must match at least one case.
The check does not publish lessons or test editor delivery.
The editor sees source text. Unlike the WGSL check, its regex can also match a comment.
