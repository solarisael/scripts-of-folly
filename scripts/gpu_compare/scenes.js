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
          const rebuilt = await render();
          assert.deepEqual(rebuilt.stats, { frames: 3, uploads: 0, passes: 6 });
          assert.deepEqual(rebuilt.builds, [...initial.builds, ...names.map((name) => [name, 1])]);
          assert.deepEqual(rebuilt.releases, initial.builds);
          assert(Buffer.from(png).equals(await capture("-rebuilt")), `${backend}: rebuilt picture changed`);
          console.log(`${backend}: visible RGBA ${visible}; 2 passes/frame; all 4 inputs rebuilt on device 2`);
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
