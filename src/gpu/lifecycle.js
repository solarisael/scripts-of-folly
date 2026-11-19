// The life of the renderer of one install. This module owns each transition.
//
// States:
//   idle        There is no renderer. `boot()` starts one.
//   booting     `boot()` waits for a backend.
//   ready       `renderer` is set.
//   recovering  The backend was lost. `recover()` tries the WebGL2 leg once.
//   failed      No backend works. `rearm()` permits a new `boot()`.
//   dead        `dispose()` ran. This state is final.
//
// `epoch` goes up when a recovery starts and when the install dies. Async
// work keeps the epoch of its start as a token. `is_alive(token)` tells if
// the result of that work still applies.
//
// The hooks let the install follow a transition:
//   on_release()  Before the renderer goes: stop drawing, release each item.
//   on_restart()  After a recovery: prepare each target on the new renderer.
//   on_restore()  After a failure: show each target as native text.
import { create_renderer, dispose_renderer } from "./renderer.js";

export function create_renderer_lifecycle({
  document_value,
  backend = "auto",
  open_gpu = undefined,
  on_gpu_time = () => {},
  on_release = () => {},
  on_restart = async () => {},
  on_restore = () => {},
}) {
  let renderer = null;
  let canvas = null;
  let boot_promise = null;
  let epoch = 0;
  let dead = false;
  let failed = false;
  let recovering = false;
  let fallback_attempted = backend === "webgl2";
  let warned_failure_epoch = -1;

  function is_alive(token = epoch) {
    return !dead && token === epoch;
  }

  function report_failure(error) {
    if (warned_failure_epoch === epoch) return;
    warned_failure_epoch = epoch;
    console.warn(
      "[Scripts of Folly] GPU effects unavailable; keeping native CSS.",
      error,
    );
  }

  function make_canvas() {
    const next_canvas = document_value.createElement("canvas");
    next_canvas.className = "folly-gpu-canvas";
    next_canvas.setAttribute("aria-hidden", "true");
    (document_value.body || document_value.documentElement)?.append(
      next_canvas,
    );
    return next_canvas;
  }

  function drop_canvas() {
    canvas?.remove();
    canvas = null;
  }

  function drop_renderer() {
    dispose_renderer(renderer);
    renderer = null;
    drop_canvas();
  }

  // idle -> booting -> ready. A second call during a boot gets the same
  // promise. A failed boot goes to `failed` and throws.
  async function boot(requested_backend = backend) {
    if (renderer || dead || failed) return renderer;
    if (boot_promise) return boot_promise;

    const token = epoch;
    boot_promise = (async () => {
      canvas = make_canvas();
      const created = await create_renderer(canvas, {
        backend: requested_backend,
        is_alive: () => is_alive(token),
        on_lost: (loss_error) => recover(loss_error),
        on_gpu_time,
        open: open_gpu,
      });

      if (!created || !is_alive(token)) {
        created?.dispose?.();
        drop_canvas();
        return null;
      }

      renderer = created;
      canvas = created.canvas || canvas;
      canvas.dataset.follyRenderer = created.backend;

      return renderer;
    })();
    try {
      const result = await boot_promise;
      if (result?.backend === "webgl2") fallback_attempted = true;
      return result;
    } catch (error) {
      if (dead || token !== epoch) return null;

      failed = true;
      report_failure(error);
      on_restore();
      drop_canvas();
      throw error;
    } finally {
      boot_promise = null;
    }
  }

  // ready -> recovering -> ready on the WebGL2 leg, or -> failed. A loss of
  // the WebGL2 leg, or a second loss, goes to `failed`.
  async function recover(loss_error) {
    if (dead || recovering) return;

    recovering = true;
    const lost_backend = renderer?.backend;
    epoch += 1;
    const recovery_epoch = epoch;
    on_release();
    drop_renderer();

    try {
      if (lost_backend === "webgl2" || fallback_attempted) {
        failed = true;
        report_failure(
          loss_error || new Error("GPU backend lost after fallback"),
        );
        return;
      }
      fallback_attempted = true;
      await boot("webgl2");
      if (renderer) {
        failed = false;
        await on_restart();
      }
    } catch (error) {
      if (dead || recovery_epoch !== epoch) return;

      failed = true;
      report_failure(
        loss_error
          ? new AggregateError([loss_error, error], "GPU fallback failed")
          : error,
      );
      on_restore();
      renderer = null;
    } finally {
      recovering = false;
    }
  }

  // Any live state -> failed, for an error that no fallback can repair.
  function fail(error) {
    failed = true;
    report_failure(error);
    on_restore();
    drop_renderer();
  }

  // failed -> idle. The next `boot()` tries the requested backend again.
  function rearm() {
    failed = false;
    fallback_attempted = backend === "webgl2";
    warned_failure_epoch = -1;
  }

  function dispose() {
    if (dead) return;

    dead = true;
    epoch += 1;
    on_release();
    drop_renderer();
  }

  return {
    get renderer() {
      return renderer;
    },
    get canvas() {
      return canvas;
    },
    get dead() {
      return dead;
    },
    get failed() {
      return failed;
    },
    get epoch() {
      return epoch;
    },
    // True when a backend error can still fall back to the WebGL2 leg.
    get can_fall_back() {
      return renderer?.backend === "webgpu" && !fallback_attempted;
    },
    is_alive,
    boot,
    recover,
    fail,
    rearm,
    dispose,
  };
}
