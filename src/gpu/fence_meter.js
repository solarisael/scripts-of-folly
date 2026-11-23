// One completion sample covers all atlas submissions in the sampled rAF.
// Never queue more samples behind a GPU that has not finished the first.
export function create_fence_meter(gl, budget, host = globalThis) {
  let sync = null;
  // Each message yields a task without the 4 ms clamp on nested timers.
  const { port1, port2 } = new host.MessageChannel();
  port1.onmessage = poll;
  let frame;
  let started;

  function release() {
    if (sync) gl.deleteSync(sync);
    sync = null;
  }

  function poll() {
    if (!sync) return;
    const result = gl.clientWaitSync(sync, 0, 0);
    if (result === gl.TIMEOUT_EXPIRED) {
      port2.postMessage(null);
      return;
    }
    release();
    if (result === gl.WAIT_FAILED) budget.fence_failed();
    else budget.fence_sample(host.performance.now() - started);
  }

  return {
    submitted(frame_time, start) {
      if (sync && frame !== frame_time) return;
      const first = !sync;
      if (first) started = start;
      release();
      frame = frame_time;
      sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (!sync) {
        this.dispose();
        budget.fence_failed();
        return;
      }
      gl.flush();
      if (first) port2.postMessage(null);
    },
    dispose() {
      port1.close();
      port2.close();
      release();
    },
  };
}
