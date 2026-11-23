// Compares the GPU text runtime of two Folly trees in a real browser.
//
// bun run gpu:compare --before <revision or directory> [--after <directory>]
//
// The script builds one test page from each tree and serves both. It does
// the same steps on each page, and it compares the state and the picture of
// each effect after each step. `--after` is this repository by default.
//
// The browser:
//   --browser <url>      A browser that already runs, by its debugging URL.
//   --executable <path>  A Chromium browser to start, headless, with software
//                        WebGL2. The default is CHROME_PATH.
// A browser on another machine must load the page from its own 127.0.0.1:
// forward the port of this server to it. Other origins are not secure, and
// then the page has no WebGPU.
//
// Other options:
//   --port <number>      The port of the page server. The default is 4399.
//   --settle <ms>        The wait after each step. The default is 900.
//   --motion <list>      "reduced", "full", or both. The default is both.
//   --counters           Also compare the count of canvases and of refreshes.
//                        On a fast GPU these counts depend on the clock.
//   --stale <rounds>     Count the stale captures after a late style change.
//   --bench <rounds>     Time a full recapture of all effects.
//   --scenes <directory> Check compositor passes, blends and loss on both
//                        backends and save visible before/after screenshots.

import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { compare_scenes, scene_html } from "./gpu_compare/scenes.js";

const here = import.meta.dir;
const repository = resolve(here, "..");
const flag = (name) => process.argv.includes(`--${name}`);
const option = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
};

const before = option("before", null);
if (!before) {
  console.error("gpu:compare needs --before <revision or directory>.");
  process.exit(2);
}
const settle = Number(option("settle", "900"));
const scene_directory = option("scenes", null);
const port = Number(option("port", "4399"));
const stale_rounds = Number(option("stale", "0"));
const bench_rounds = Number(option("bench", "0"));
const with_counters = flag("counters");
const modes = option("motion", "reduced,full").split(",");
const work = mkdtempSync(join(tmpdir(), "folly-gpu-compare-"));

const is_directory = (path) => {
  try {
    return statSync(path).isDirectory();
  } catch (error) {
    // A path that does not exist is a git revision.
    if (error.code === "ENOENT") return false;
    throw error;
  }
};

// A revision becomes a directory with the files of that commit and the
// packages of this repository.
async function tree_of(source) {
  if (is_directory(source)) return resolve(source);
  const target = join(work, "revision");
  mkdirSync(target);
  const archive = Bun.spawn(["git", "archive", source], {
    cwd: repository,
    stdout: "pipe",
    stderr: "inherit",
  });
  const unpack = Bun.spawn(["tar", "-x", "-C", target], {
    stdin: archive.stdout,
    stderr: "inherit",
  });
  if ((await archive.exited) !== 0 || (await unpack.exited) !== 0)
    throw new Error(`git has no revision "${source}".`);
  symlinkSync(join(repository, "node_modules"), join(target, "node_modules"));
  return target;
}

const trees = {
  before: await tree_of(before),
  after: resolve(option("after", repository)),
};
const html = scene_directory ? scene_html : readFileSync(join(here, "gpu_compare", "index.html"), "utf8");
const page_script = readFileSync(join(here, "gpu_compare", scene_directory ? "scene_page.js" : "page.js"), "utf8");
for (const [name, tree] of Object.entries(trees)) {
  const source = join(work, `page-${name}`);
  mkdirSync(source);
  writeFileSync(join(source, "index.html"), html);
  writeFileSync(join(source, "main.js"), page_script.replaceAll("__REPO__", tree));
  const result = await Bun.build({
    entrypoints: [join(source, "index.html")],
    outdir: join(work, `dist-${name}`),
  });
  if (!result.success) {
    console.error(result.logs);
    throw new Error(`The page of the ${name} tree does not build.`);
  }
}

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(request) {
    const [, name, ...rest] = new URL(request.url).pathname.split("/");
    const file = Bun.file(
      join(work, `dist-${name}`, rest.join("/") || "index.html"),
    );
    return (await file.exists())
      ? new Response(file)
      : new Response("not found", { status: 404 });
  },
});

const browser_url = option("browser", null);
const executable = option("executable", process.env.CHROME_PATH);
if (!browser_url && !executable) {
  console.error("gpu:compare needs --browser <url> or --executable <path>.");
  process.exit(2);
}
const browser = browser_url
  ? await puppeteer.connect({ browserURL: browser_url })
  : await puppeteer.launch({
      executablePath: executable,
      headless: true,
      args: [
        "--no-sandbox",
        "--ignore-gpu-blocklist",
        "--enable-unsafe-swiftshader",
        ...(scene_directory
          ? ["--enable-unsafe-webgpu", "--enable-features=Vulkan", "--use-angle=vulkan", "--use-vulkan=native"]
          : ["--use-angle=swiftshader"]),
        "--force-device-scale-factor=1",
      ],
    });

const STEPS = [
  "initial",
  "text",
  "outside_class",
  "outside_style",
  "add_node",
  "change_effect",
  "remove_node",
  "intensity",
  "nested_text",
  "scroll",
  "unclip",
  "swap_event",
  "hide",
  "show",
  "lose_gpu",
  "refresh_api",
  "text_again",
  "dispose_api",
  "after_dispose",
];

async function open(name, reduced) {
  const page = await browser.newPage();
  const logs = [];
  page.on("console", (message) => logs.push(message.text()));
  page.on("pageerror", (error) => logs.push(`PAGEERROR ${error.message}`));
  await page.setViewport({ width: 900, height: 700, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([
    {
      name: "prefers-reduced-motion",
      value: reduced ? "reduce" : "no-preference",
    },
  ]);
  await page.goto(`http://127.0.0.1:${port}/${name}/`, { waitUntil: "load" });
  await page.waitForFunction("window.__ready === true", { timeout: 20000 });
  return { page, logs };
}

const pause = (ms) => new Promise((done) => setTimeout(done, ms));
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const warnings = (logs) =>
  logs.filter((line) => /error|warn|unavailable/i.test(line)).slice(0, 4);

async function run_steps(name, reduced) {
  const { page, logs } = await open(name, reduced);
  const steps = {};
  for (const step of STEPS) {
    steps[step] = await page.evaluate(
      (step_name, ms) => window.__step(step_name, ms),
      step,
      settle,
    );
  }
  await page.close();
  return { steps, logs };
}

// With motion the pictures and the copy count depend on the clock.
const comparable = (steps, reduced) =>
  JSON.parse(
    JSON.stringify(steps, (key, value) =>
      (!reduced && (key === "pixels" || key === "copies")) ||
      (!with_counters && key === "counts")
        ? undefined
        : value,
    ),
  );

async function compare_steps(reduced) {
  const old_run = await run_steps("before", reduced);
  const new_run = await run_steps("after", reduced);
  const left = comparable(old_run.steps, reduced);
  const right = comparable(new_run.steps, reduced);
  const same = JSON.stringify(left) === JSON.stringify(right);
  console.log(
    `${reduced ? "reduced motion" : "full motion"}: ${same ? "identical" : "DIFFERENT"}`,
  );
  for (const step of ["initial", "lose_gpu", "refresh_api", "dispose_api"]) {
    const brief = ({ steps }) =>
      `${steps[step].renderer}, ${steps[step].presenters} effects`;
    console.log(`  after ${step}: ${brief(old_run)} | ${brief(new_run)}`);
  }
  for (const step of STEPS) {
    for (const key of Object.keys(left[step])) {
      const a = JSON.stringify(left[step][key]);
      const b = JSON.stringify(right[step][key]);
      if (a !== b)
        console.log(`  ${step}/${key}\n    before ${a}\n    after  ${b}`);
    }
  }
  for (const [name, run] of [
    ["before", old_run],
    ["after", new_run],
  ]) {
    if (warnings(run.logs).length)
      console.log(`  ${name} console:`, warnings(run.logs));
  }
  return same;
}

async function count_stale(name) {
  const { page } = await open(name, true);
  await pause(1500);
  const stale = await page.evaluate(
    (rounds, ms) => window.__stale(rounds, ms),
    stale_rounds,
    settle,
  );
  await page.close();
  console.log(`stale ${name}: ${stale} of ${stale_rounds} rounds`);
}

async function bench(name) {
  const { page, logs } = await open(name, false);
  await pause(1500);
  const first = await page.evaluate(() => window.__snapshot());
  const idle_gap = await page.evaluate(() => window.__idle_gap());
  const rounds = await page.evaluate(
    (count) => window.__bench(count),
    bench_rounds,
  );
  await page.close();
  const gaps = rounds.map((round) => round.max_gap);
  console.log(
    `bench ${name}: ${first.renderer}, ${first.presenters} effects, ` +
      `settled in ${median(rounds.map((round) => round.settle_ms)).toFixed(1)} ms, ` +
      `frame gap ${median(gaps).toFixed(1)} ms (worst ${Math.max(...gaps).toFixed(1)}, idle ${idle_gap.toFixed(1)})`,
  );
  if (warnings(logs).length) console.log("  console:", warnings(logs));
}

let failed = false;
try {
  if (scene_directory) {
    await compare_scenes(browser, `http://127.0.0.1:${server.port}`, scene_directory);
  } else if (stale_rounds > 0) {
    for (const name of ["before", "after"]) await count_stale(name);
  } else if (bench_rounds > 0) {
    // Two passes for each tree show the spread of the numbers.
    for (const name of ["before", "after", "before", "after"]) await bench(name);
  } else {
    for (const mode of modes)
      failed = !(await compare_steps(mode === "reduced")) || failed;
  }
} finally {
  if (browser_url) browser.disconnect();
  else await browser.close();
  server.stop(true);
  rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
