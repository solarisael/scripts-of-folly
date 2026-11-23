import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export const scene_html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="icon" href="data:,">
<style>body{margin:0;background:#222}canvas{display:block;width:192px;height:128px}</style>
</head><body><canvas width="192" height="128"></canvas><script type="module" src="./main.js"></script></body></html>`;

// Decode the composited screenshot, not the render target, to check the visible blend.
async function pixel(page, png) {
  return page.evaluate(async (url) => {
    const image = await createImageBitmap(await (await fetch(url)).blob());
    const ctx = new OffscreenCanvas(1, 1).getContext("2d");
    ctx.drawImage(image, image.width >> 1, image.height >> 1, 1, 1, 0, 0, 1, 1);
    return [...ctx.getImageData(0, 0, 1, 1).data];
  }, `data:image/png;base64,${Buffer.from(png).toString("base64")}`);
}

export async function compare_scenes(browser, origin, directory) {
  mkdirSync(directory, { recursive: true });
  for (const backend of ["webgpu", "webgl2"]) {
    async function run(tree, kind) {
      const page = await browser.newPage();
      try {
        page.on("console", (message) => {
          if (["warn", "error"].includes(message.type())) console.error(`${tree}/${backend}/${kind}: ${message.text()}`);
        });
        page.on("pageerror", (error) => console.error(`${tree}/${backend}/${kind}:`, error));
        await page.setViewport({ width: 192, height: 128, deviceScaleFactor: 1 });
        await page.goto(`${origin}/${tree}/?backend=${backend}&kind=${kind}`);
        await page.waitForFunction(() => window.scene_test, { timeout: 20000 });
        const render = () => page.evaluate(() => window.scene_test.render());
        async function capture(suffix) {
          const path = join(directory, `${tree}-${backend}-${kind}${suffix}.png`);
          const png = await page.screenshot({ path });
          console.log(path, createHash("sha256").update(png).digest("hex"));
          return png;
        }
        const initial = await render();
        assert.equal(initial.backend, backend);
        const png = await capture("");
        if (kind === "image") {
          assert.deepEqual(initial.stats, { frames: 1, uploads: 3, passes: 9 });
          assert.deepEqual((await render()).stats, initial.stats);
          assert.notDeepEqual(await pixel(page, png), [34, 34, 34, 255], "background visible instead of image");
        } else {
          const names = ["reader", "add", "over", "field"];
          assert.deepEqual(initial.stats, { frames: 1, uploads: 0, passes: 2 });
          assert.deepEqual(initial.builds, names.map((name) => [name, 0]));
          // (48,64,112) + (32,12,4), then half-opacity premultiplied (0,32,64).
          const visible = await pixel(page, png);
          const expected = [40, 70, 122, 255];
          assert(visible.every((v, i) => Math.abs(v - expected[i]) <= 1), `visible ${visible}, expected ${expected}`);
          const unchanged = await render();
          assert.deepEqual(unchanged.stats, { frames: 2, uploads: 0, passes: 4 });
          assert.deepEqual(unchanged.builds, initial.builds);
          await page.evaluate(() => window.scene_test.lose());
          if (backend === "webgpu") {
            await page.waitForFunction(() => window.scene_test.snapshot().builds.length === 8);
            const rebuilt = await page.evaluate(() => window.scene_test.snapshot());
            assert.equal(rebuilt.backend, "webgl2");
            assert.deepEqual(rebuilt.stats, { frames: 3, uploads: 0, passes: 6 });
            assert.deepEqual(rebuilt.builds, [...initial.builds, ...names.map((name) => [name, 1])]);
            assert.deepEqual(rebuilt.releases, initial.builds);
            assert(Buffer.from(png).equals(await capture("-rebuilt")), "rebuilt picture changed");
          } else {
            await page.waitForFunction(() => window.scene_test.snapshot().backend === null);
            await assert.rejects(render(), /page GPU is unavailable/);
          }
          console.log(`${backend}: visible RGBA ${visible}; 2 passes/frame; loss released all 4 inputs`);
        }
        await page.evaluate(() => window.scene_test.dispose());
        return png;
      } finally {
        await page.close();
      }
    }
    const before = await run("before", "image");
    const after = await run("after", "image");
    assert(Buffer.from(before).equals(after), `${backend}: image composition changed`);
    console.log(`${backend}: before and after image/backdrop screenshots are identical`);
    await run("after", "planes");
  }
}

// Check pixels from the displayed page. Text readiness alone also passes
// with an invisible or empty presenter.
async function mixed_picture(page, path, expected = [40, 70, 122, 255]) {
  const png = await page.screenshot({ path });
  const { scene, ink } = await page.evaluate(async (url) => {
    const image = await createImageBitmap(await (await fetch(url)).blob());
    const context = new OffscreenCanvas(image.width, image.height).getContext("2d");
    context.drawImage(image, 0, 0);
    image.close();
    const pixels = context.getImageData(0, 138, 190, 48).data;
    let ink = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (Math.max(pixels[i], pixels[i + 1], pixels[i + 2]) > 160) ink++;
    return { scene: [...context.getImageData(96, 64, 1, 1).data], ink };
  }, `data:image/png;base64,${Buffer.from(png).toString("base64")}`);
  assert(scene.every((v, i) => Math.abs(v - expected[i]) <= 1), `scene: ${scene}, expected ${expected}`);
  assert(ink > 100, `only ${ink} visible text pixels`);
  console.log(`${path}: scene ${scene}, ${ink} ink pixels; ${createHash("sha256").update(png).digest("hex")}`);
}

export async function check_shared_page(browser, origin, directory) {
  mkdirSync(directory, { recursive: true });
  const failures = [];
  for (const backend of ["webgpu", "webgl2"]) {
    const page = await browser.newPage();
    try {
      page.on("pageerror", (error) => failures.push(error));
      await page.setViewport({ width: 260, height: 200, deviceScaleFactor: 1 });
      await page.goto(`${origin}?kind=shared&backend=${backend}`);
      await page.waitForFunction(() => window.scene_test?.snapshot().ready === "ready");
      const snapshot = () => page.evaluate(() => window.scene_test.snapshot());
      await page.evaluate(() => window.scene_test.render());
      const initial = await snapshot();
      assert.equal(initial.backend, backend);
      assert.equal(initial.text_backend, backend);
      assert(initial.adapters.every((a) => a.trim() && !/swiftshader|llvmpipe/i.test(a)), `software adapter: ${initial.adapters}`);
      console.log(`${backend}: ${initial.adapters.join(", ")}`);
      await mixed_picture(page, join(directory, `${backend}-mixed.png`));
      if (initial.opens !== 1) failures.push(Error(`${backend}: mixed page opened ${initial.opens} devices`));

      await page.evaluate(() => window.scene_test.move());
      try {
        await page.waitForFunction(() => window.scene_test.snapshot().levels.some(([level]) => level === 2), { timeout: 4000 });
        const { levels } = await snapshot();
        assert(levels.every(([level, w, h]) => (level === 0 && w === 96 && h === 64) || (level === 2 && w === 48 && h === 32)));
        console.log(`${backend}: field accepted level 2 at 48 × 32, skipping level 1`);
      } catch (error) {
        failures.push(Error(`${backend}: field did not receive its budget level: ${JSON.stringify((await snapshot()).levels.slice(-3))}`, { cause: error }));
      }
      await page.evaluate(() => window.scene_test.stop());

      if (backend === "webgpu") await page.evaluate(() => window.scene_test.hold_build());
      await page.evaluate(() => window.scene_test.lose());
      try {
        if (backend === "webgpu") {
          await page.waitForFunction(() => {
            const s = window.scene_test.snapshot();
            return s.ready === "ready" && s.text_backend === "webgl2" && s.builds.length === 10;
          }, { timeout: 4000 });
          const rebuilt = await snapshot();
          assert.equal(rebuilt.opens, 2);
          assert.equal(rebuilt.new_presenter, true);
          assert.deepEqual(rebuilt.releases, initial.builds);
          const names = [...initial.builds.map(([name]) => name), "pending"];
          assert.deepEqual(rebuilt.builds.slice(5), names.map((name) => [name, 1]));
          await page.evaluate(() => window.scene_test.finish_build());
          await page.waitForFunction(() => window.scene_test.snapshot().releases.length === 5);
          await mixed_picture(page, join(directory, "webgpu-rebuilt-webgl2.png"));
          console.log("One WebGL2 recovery rebuilt text and five inputs before the old build finished");
          await page.evaluate(() => window.scene_test.lose(1));
          await page.waitForFunction(() => !window.scene_test.snapshot().ready, { timeout: 4000 });
          const terminal = await snapshot();
          assert.equal(terminal.opens, 2);
          assert.deepEqual(terminal.releases, terminal.builds);
        } else {
          await page.waitForFunction(() => !window.scene_test.snapshot().ready, { timeout: 4000 });
          const failed = await snapshot();
          assert.equal(failed.opens, 1);
          assert.deepEqual(failed.releases, initial.builds);
          console.log("WebGL2 loss released all four inputs and restored native text without reopening");
        }
        await mixed_picture(page, join(directory, `${backend}-native.png`), [34, 34, 34, 255]);
      } catch (error) {
        const { opens, builds, releases, text_backend } = await snapshot();
        failures.push(Error(`${backend}: mixed loss did not settle: ${JSON.stringify({ opens, builds, releases, text_backend })}`, { cause: error }));
      }
      assert.deepEqual((await snapshot()).faults, []);
      await page.evaluate(() => window.scene_test.dispose());
    } finally {
      await page.close();
    }
  }
  if (failures.length) throw new AggregateError(failures, "Shared page checks failed");
}
