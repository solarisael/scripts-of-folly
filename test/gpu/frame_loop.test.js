import { expect, test } from "bun:test";
import { create_frame_budget } from "../../src/gpu/budget.js";
import { create_frame_loop } from "../../src/gpu/frame_loop.js";

const VISIBLE_STYLE = {
  display: "block",
  visibility: "visible",
  opacity: "1",
  overflow: "visible",
  overflowX: "visible",
  overflowY: "visible",
};

function make_item() {
  const attributes = new Map();
  return {
    target: {
      getAttribute: (name) => attributes.get(name) ?? null,
      setAttribute: (name, value) => attributes.set(name, value),
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 20 }),
      parentElement: null,
    },
    names: ["glow"],
    kind: "text",
    wants_frame: () => true,
    handle: {},
    width: 100,
    height: 20,
    presentation: {
      canvas: { width: 0, height: 0, style: {} },
      context: { clearRect() {}, drawImage() {} },
    },
  };
}

// A page with one renderer whose `render` waits until the test releases it.
function make_page({ reduced_motion, fps = null }) {
  const frames = [];
  const timers = [];
  const first_render = Promise.withResolvers();
  const renders = [];
  let release = () => {};
  const element = { getAttribute: () => fps, clientWidth: 800, clientHeight: 600 };
  const view = {
    devicePixelRatio: 1,
    innerWidth: 800,
    innerHeight: 600,
    performance: { now: () => 0 },
    matchMedia: () => ({ matches: reduced_motion }),
    getComputedStyle: () => VISIBLE_STYLE,
    requestAnimationFrame: (callback) => frames.push(callback),
    cancelAnimationFrame() {},
    setTimeout: (callback) => timers.push(callback),
    clearTimeout() {},
  };
  const document_value = {
    nodeType: 9,
    visibilityState: "visible",
    documentElement: element,
    body: element,
  };
  const lifecycle = {
    dead: false,
    renderer: {
      canvas: {},
      resize() {},
      render(entries) {
        first_render.resolve();
        renders.push(entries.length);
        return new Promise((resolve) => (release = resolve));
      },
    },
    async recover() {},
  };
  const items = new Map();
  const compositions = new Set();
  const budget = create_frame_budget({ now: () => 0 });
  const frame = create_frame_loop({
    view,
    document_value,
    texts: new Set([{ root: document_value, items }]),
    compositions,
    budget,
    lifecycle,
  });
  return {
    frames, first_render: first_render.promise,
    timers,
    frame,
    budget,
    items,
    compositions,
    renders,
    // Runs the frame that the loop asked for, after the timer that paces it.
    // False when the loop asked for none.
    run_frame(time = 16) {
      for (const timer of timers.splice(0)) timer();
      const callback = frames.shift();
      if (!callback) return false;
      callback(time);
      return true;
    },
    async finish_render() {
      const drawing = frame.drawing;
      release();
      await drawing;
      await Promise.resolve();
    },
  };
}

test("reduced motion: an effect added during a frame gets the next frame", async () => {
  const page = make_page({ reduced_motion: true });
  const first = make_item();
  page.items.set(first.target, first);

  page.frame.schedule();
  expect(page.run_frame()).toBe(true);
  expect(page.renders).toEqual([1]);

  // The runtime prepares a second effect while the first frame is on the GPU.
  const second = make_item();
  page.items.set(second.target, second);
  page.frame.invalidate();
  page.frame.schedule();
  await page.finish_render();

  expect(page.run_frame()).toBe(true);
  expect(page.renders).toEqual([1, 2]);
  await page.finish_render();
  expect(second.target.getAttribute("data-folly-gpu-text")).toBe("ready");

  // The picture is now valid, so reduced motion asks for no more frames.
  expect(page.run_frame()).toBe(false);
});

test("a renderer that skips display ticks does not set the display interval", async () => {
  const page = make_page({ reduced_motion: false, fps: "display" });
  const item = make_item();
  page.items.set(item.target, item);
  page.frame.schedule();
  page.run_frame(100);
  page.run_frame(108); // The display ticks while the renderer is still busy.
  await page.finish_render();
  page.run_frame(132);
  expect(page.budget.report().frame_ms).toBe(8);
  await page.finish_render();
  page.frame.stop();
});

test("one page tick draws text and both moving compositions against the same budget", async () => {
  const page = make_page({ reduced_motion: false });
  const text = make_item();
  page.items.set(text.target, text);
  const draws = [];
  for (const share of [2, 4]) {
    page.compositions.add({
      share,
      continues: true,
      wants_frame: () => true,
      draw: (now) => draws.push([share, now]),
    });
  }
  page.frame.schedule();
  page.frame.schedule();
  expect(page.frames.length).toBe(1);
  page.run_frame(125);
  await page.first_render;
  await page.finish_render();
  expect(draws).toEqual([[2, 125], [4, 125]]);
  expect(page.renders).toEqual([1]);
  expect(page.budget.report().effects.map((item) => item.share).sort()).toEqual([1, 2, 4]);
});

test("a resting composition takes no share or submission and leaves no tick queued", async () => {
  const page = make_page({ reduced_motion: false });
  let moving = true;
  let draws = 0;
  page.compositions.add({
    continues: true,
    wants_frame: () => moving,
    draw() { draws++; moving = false; },
  });
  page.frame.schedule();
  page.run_frame(32);
  await page.finish_render();
  // A final demand check may run. It must not submit even an empty atlas.
  if (page.run_frame(64)) await page.finish_render();
  expect(draws).toBe(1);
  expect(page.renders).toEqual([]);
  expect(page.budget.report().effects).toEqual([]);
  expect(page.run_frame(96)).toBe(false);
});

test("an invalidated still keeps the text fps limit between requests", async () => {
  const page = make_page({ reduced_motion: true, fps: "5" });
  const item = make_item();
  page.items.set(item.target, item);
  page.frame.schedule();
  page.run_frame(16);
  await page.finish_render();
  page.frame.invalidate();
  page.frame.schedule();
  expect(page.timers.length).toBe(1);
});
