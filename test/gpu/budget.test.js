import { expect, test } from "bun:test";
import { create_frame_budget } from "../../src/gpu/budget.js";

function page() {
  let now = 0;
  const budget = create_frame_budget({ now: () => now });
  const items = ["glow", "aura"].map((name) => ({ names: [name], handle: { span_name: name } }));
  function frame(gap) {
    now += gap ?? 0;
    budget.settle(items, 16, gap);
    for (const item of items) {
      if (budget.due(item, now)) budget.drawn(item, now, 16, 100, budget.level_of(item).scale);
    }
  }
  const levels = () => budget.report().effects.map(({ level }) => level);
  return { budget, frame, levels };
}

test("the sum of all timestamp batches loses trust at the observed gap, for the session", () => {
  const { budget, frame, levels } = page();
  const backend = { timestamps: true, fences: false };
  budget.backend_opened(backend);
  frame(null);
  budget.timestamp_batch({ aura: 20 });
  frame(32); // Longer than the target interval, but not longer than this frame.
  expect(budget.report().effects[1].cost_ms).toBe(20);
  budget.timestamp_batch({ glow: 12 });
  budget.timestamp_batch({ aura: 13 });
  frame(16);
  expect(budget.source).toBe("frame_gaps");
  expect(budget.report().effects.map(({ cost_ms }) => cost_ms)).toEqual([null, null]);
  for (let i = 0; i < 40; i++) {
    budget.timestamp_batch({ aura: 25 });
    frame(16);
  }
  expect(levels()).toEqual([0, 0]);
  budget.backend_opened(backend);
  expect(budget.source).toBe("frame_gaps");
  budget.backend_opened({ timestamps: true, fences: true });
  expect(budget.source).toBe("fences");
});

test("submission fences can lower a share even when the frames arrive on time", () => {
  const { budget, frame, levels } = page();
  budget.backend_opened({ timestamps: false, fences: true });
  frame(null);
  for (let i = 0; i < 34; i++) {
    budget.fence_sample(10); // More than the 8 ms page share.
    frame(16);
  }
  expect(levels()).toEqual([0, 1]);
  expect(budget.report().fence_ms).toBe(10);
  expect(budget.report().effects[1].cost_ms).toBeNull();
  budget.fence_failed();
  budget.fence_sample(100); // A late callback must not restore fences.
  expect(budget.report().source).toBe("frame_gaps");
  expect(budget.report().fence_ms).toBeNull();
});

test("missed frames lower only the costliest share; recovery needs uninterrupted room", () => {
  const { frame, levels } = page();
  frame(null);
  for (let i = 0; i < 17; i++) frame(32);
  expect(levels()).toEqual([0, 1]);
  for (let i = 0; i < 180; i++) frame(16);
  frame(32);
  for (let i = 0; i < 188; i++) frame(16);
  expect(levels()).toEqual([0, 1]);
  frame(16);
  expect(levels()).toEqual([0, 0]);
});
