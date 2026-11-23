import { create_renderer, dispose_renderer } from "./renderer.js";
import { create_frame_budget } from "./budget.js";
import { create_frame_loop } from "./frame_loop.js";

const pages = new WeakMap();

function create_lifecycle(document_value, { backend = "auto", open_gpu }, budget, release, restart) {
  let state = "idle"; // idle | booting | ready | recovering | failed | dead
  let renderer = null, opening = null, epoch = 0;
  let used_fallback = false;
  const is_alive = (token) => state !== "dead" && token === epoch;

  function drop(reason) {
    // All clients release their own objects before the page drops the device.
    release(reason);
    dispose_renderer(renderer);
    renderer?.canvas.remove();
    renderer = null;
  }
  function fail(error) {
    if (state === "failed" || state === "dead") return;
    state = "failed";
    epoch++;
    opening = null;
    drop(error);
    console.warn("[Scripts of Folly] GPU effects unavailable; keeping native CSS.", error);
  }
  async function open(kind, token) {
    const canvas = document_value.createElement("canvas");
    canvas.className = "folly-gpu-canvas";
    canvas.width = canvas.height = 1;
    canvas.hidden = true;
    canvas.setAttribute("aria-hidden", "true");
    (document_value.body || document_value.documentElement)?.append(canvas);
    let early_loss;
    try {
      const next = await create_renderer(canvas, {
        backend: kind, budget, open: open_gpu,
        is_alive: () => is_alive(token),
        on_lost(reason) {
          if (!is_alive(token)) return;
          if (state === "ready") void recover(reason);
          else early_loss = reason;
        },
      });
      if (!next || !is_alive(token) || early_loss) {
        dispose_renderer(next);
        next?.canvas.remove();
        canvas.remove();
        if (early_loss) throw early_loss;
        return null;
      }
      if (state === "recovering" && next.backend !== "webgl2") {
        dispose_renderer(next);
        next.canvas.remove();
        throw new Error("The page recovery requires a WebGL2 device.");
      }
      renderer = next;
      renderer.canvas.dataset.follyRenderer = next.backend;
      used_fallback = next.backend === "webgl2";
      state = "ready";
      return next;
    } catch (error) {
      canvas.remove();
      if (!is_alive(token)) return null;
      fail(error);
      throw error;
    }
  }
  function boot() {
    if (state === "booting" || state === "recovering") return opening;
    if (state !== "idle") return renderer;
    state = "booting";
    opening = open(backend, epoch);
    return opening;
  }
  async function recover(reason) {
    if (state !== "ready") return;
    if (used_fallback) { fail(reason); return; }
    state = "recovering";
    const token = ++epoch;
    drop(reason);
    try {
      opening = open("webgl2", token);
      if (await opening && is_alive(token)) await restart();
    } catch (error) {
      if (is_alive(token)) fail(error);
    }
  }
  return {
    get renderer() { return renderer; },
    get canvas() { return renderer?.canvas; },
    get dead() { return state === "dead"; },
    get failed() { return state === "failed"; },
    get epoch() { return epoch; },
    get can_fall_back() { return state === "ready" && !used_fallback; },
    is_alive, boot, recover, fail,
    rearm() { if (state === "failed") state = "idle"; },
    dispose() {
      if (state === "dead") return;
      state = "dead";
      epoch++;
      drop(new Error("The page GPU was disposed."));
      opening = null;
    },
  };
}

// Document identity, not the order in which scripts load, is the ownership
// boundary. A text install can leave without taking a composition down.
export function join_gpu_page(document_value, options, client, kind) {
  let page = pages.get(document_value);
  if (!page) {
    const view = document_value.defaultView;
    const texts = new Set(), compositions = new Set();
    const budget = create_frame_budget({ now: () => view.performance.now() });
    const release = (reason) => {
      frame.stop();
      for (const group of [texts, compositions]) {
        for (const item of group) {
          try { item.release(reason); }
          catch (error) { console.error("[Scripts of Folly] GPU resource cleanup failed.", error); }
        }
      }
    };
    const restart = async () => {
      for (const item of compositions) item.restart();
      for (const item of texts) await item.restart();
      frame.invalidate();
      frame.schedule();
    };
    const lifecycle = create_lifecycle(document_value, options, budget, release, restart);
    const frame = create_frame_loop({ view, document_value, texts, compositions, budget, lifecycle });
    const visibility = () => {
      if (document_value.visibilityState === "hidden") frame.stop();
      else { frame.reset_clock(); frame.schedule(); }
    };
    document_value.addEventListener("visibilitychange", visibility);
    page = { texts, compositions, frame, lifecycle, budget, visibility };
    pages.set(document_value, page);
  }
  const clients = kind === "text" ? page.texts : page.compositions;
  clients.add(client);
  return {
    frame: page.frame, lifecycle: page.lifecycle, budget: page.budget,
    leave() {
      if (!clients.delete(client)) return;
      if (page.texts.size || page.compositions.size) return;
      document_value.removeEventListener("visibilitychange", page.visibility);
      pages.delete(document_value);
      page.lifecycle.dispose();
    },
  };
}
