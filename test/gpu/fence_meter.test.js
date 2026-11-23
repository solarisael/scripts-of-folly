import { expect, test } from "bun:test";
import { create_fence_meter } from "../../src/gpu/fence_meter.js";

test("nested timer clamping must not turn a 3.5 ms fence into a missed 120 Hz share", async () => {
  let time = 0;
  let nesting = 0;
  const host = {
    MessageChannel,
    performance: { now: () => time },
    setTimeout(callback) {
      const delay = ++nesting > 5 ? 4 : 0;
      return setTimeout(() => { time += delay; callback(); }, 0);
    },
    clearTimeout,
  };
  let created = 0;
  let deleted = 0;
  const gl = {
    TIMEOUT_EXPIRED: 1, CONDITION_SATISFIED: 2,
    fenceSync: () => ++created,
    deleteSync: () => ++deleted,
    flush() {},
    clientWaitSync(sync, flags, timeout) {
      expect([sync, flags, timeout]).toEqual([1, 0, 0]);
      time += 0.5;
      return time < 3.5 ? this.TIMEOUT_EXPIRED : this.CONDITION_SATISFIED;
    },
  };
  const sample = Promise.withResolvers();
  const meter = create_fence_meter(gl, { fence_sample: sample.resolve }, host);
  try {
    meter.submitted(0, 0);
    meter.submitted(8, 0);
    expect(await sample.promise).toBe(3.5);
    expect([created, deleted]).toEqual([1, 1]);
  } finally {
    meter.dispose();
  }
});
