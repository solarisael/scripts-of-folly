// One completion sample covers all atlas submissions in the sampled rAF.
// Never queue more samples behind a GPU that has not finished the first.
export function create_fence_meter(gl, budget) {
  let sync = null;
  let task = null;
  let frame;
  let started;

  function release() {
    if (sync) gl.deleteSync(sync);
    sync = null;
  }

  function poll() {
    task = null;
    const result = gl.clientWaitSync(sync, 0, 0);
    if (result === gl.TIMEOUT_EXPIRED) {
      task = setTimeout(poll, 0);
      return;
    }
    release();
    if (result === gl.WAIT_FAILED) budget.fence_failed();
    else budget.fence_sample(performance.now() - started);
  }

  return {
    submitted(frame_time, start) {
      if (sync && frame !== frame_time) return;
      if (!sync) started = start;
      release();
      frame = frame_time;
      sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (!sync) {
        this.dispose();
        budget.fence_failed();
        return;
      }
      gl.flush();
      task ??= setTimeout(poll, 0);
    },
    dispose() {
      if (task !== null) clearTimeout(task);
      task = null;
      release();
    },
  };
}
