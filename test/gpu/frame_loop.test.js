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
function make_page({ reduced_motion }) {
  const frames = [];
  const timers = [];
  const renders = [];
  let release = () => {};
  const element = { getAttribute: () => null, clientWidth: 800, clientHeight: 600 };
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
        renders.push(entries.length);
        return new Promise((resolve) => (release = resolve));
      },
    },
    async recover() {},
  };
  const items = new Map();
  const frame = create_frame_loop({
    view,
    document_value,
    root: document_value,
    items,
    budget: create_frame_budget({ now: () => 0 }),
    lifecycle,
    restore_target() {},
  });
  return {
    frame,
    items,
    renders,
    // Runs the frame that the loop asked for, after the timer that paces it.
    // False when the loop asked for none.
    run_frame() {
      for (const timer of timers.splice(0)) timer();
      const callback = frames.shift();
      if (!callback) return false;
      callback(16);
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
