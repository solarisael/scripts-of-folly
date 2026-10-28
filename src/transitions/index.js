// Page transitions: a cover closes over the page, the page changes under it,
// and the cover opens again on the new page.
//
//   const transition = create_page_transition({ open_gpu, mode });
//   await transition.run(() => apply_new_state());
//   bind_htmx_navigation(htmx, transition, { target: "#page" });
//
// Modes: "shader" draws COVER_WGSL on vgpu or the WebGL2 leg. "fade" fades a
// plain sheet of paper. "off" changes the page at once. A failed shader falls
// back to "fade" for the rest of the page. Reduced motion always means "off".
import { create_cover_backend } from "./backend.js";
import { COVER_EFFECTS } from "./wgsl.js";
import { open_gpu as open_folly_gpu } from "../gpu/open_gpu.js";

export { COVER_EFFECTS };
export const TRANSITION_MODES = Object.freeze(["shader", "fade", "off"]);

const COVER_CLASS = "folly-transition-cover";
// The last cover frame reaches the screen after its animation time ends: one
// more animation frame, then the GPU work. A swap waits this much longer.
const PRESENT_MARGIN_MS = 50;
const HTMX_BOUND = Symbol.for("scripts-of-folly.transitions.htmx");

const ease_in = (value) => value * value * value;
const ease_out = (value) => 1 - (1 - value) ** 3;
const clamp01 = (value) => Math.min(1, Math.max(0, value));

const random_seed = () => Math.floor(Math.random() * 2 ** 32) >>> 0;

const read_rgb = (document_value, css_color) => {
  const canvas = document_value.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return [0, 0, 0, 1];

  context.fillStyle = css_color;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return [red / 255, green / 255, blue / 255, 1];
};

// The paper is the page background; the ink is the page text colour.
const page_colors = (document_value) => {
  const body = document_value.body ?? document_value.documentElement;
  const style = document_value.defaultView.getComputedStyle(body);
  return {
    paper: read_rgb(document_value, style.backgroundColor),
    ink: read_rgb(document_value, style.color),
  };
};

const fresh_canvas = (canvas) => {
  const replacement = canvas.cloneNode(false);
  canvas.replaceWith(replacement);
  return replacement;
};

export function create_page_transition({
  document: document_value = globalThis.document,
  open_gpu = open_folly_gpu,
  mode = () => "shader",
  effect = "ink",
  z_index = 50,
  cover_ms = 420,
  reveal_ms = 560,
  colors = () => page_colors(document_value),
} = {}) {
  const view = document_value.defaultView;
  const motion = view.matchMedia?.("(prefers-reduced-motion: reduce)");

  let element = null;
  let backend = null;
  let opening = null;
  let shader_failed = false;
  let disposed = false;

  // One running animation at a time: { phase, started, duration, progress,
  // origin, seed, palette, resolve }.
  let current = null;
  let frame_request = 0;
  let drawing = false;

  const resolved_mode = () => {
    if (motion?.matches) return "off";
    const asked = mode();
    if (!TRANSITION_MODES.includes(asked)) return "shader";
    if (asked === "shader" && shader_failed) return "fade";
    return asked;
  };

  const emit = (name, detail) =>
    document_value.dispatchEvent(new view.CustomEvent(name, { detail }));

  const place = (node) => {
    node.className = COVER_CLASS;
    node.setAttribute("aria-hidden", "true");
    Object.assign(node.style, {
      position: "fixed",
      inset: "0",
      width: "100%",
      height: "100%",
      zIndex: String(z_index),
      pointerEvents: "none",
      display: "none",
    });
  };

  const show = (node, kind) => {
    if (element && element !== node) element.remove();
    element = node;
    element.dataset.follyTransition = kind;
    if (!element.isConnected) document_value.body.append(element);
  };

  const size_canvas = () => {
    const width = Math.max(1, Math.round(view.innerWidth));
    const height = Math.max(1, Math.round(view.innerHeight));
    if (element.width !== width || element.height !== height) {
      element.width = width;
      element.height = height;
    }
    backend?.resize(width, height);
    return [width, height];
  };

  const open_backend = async (canvas, kind) => {
    const opened = await open_gpu(kind);
    return create_cover_backend(canvas, opened, {
      is_alive: () => !disposed,
      on_lost: (reason) => {
        console.warn("[folly] transition cover lost its GPU device", reason);
        backend?.dispose();
        backend = null;
        opening = null;
      },
    });
  };

  // Opens the shader cover: WebGPU first, then the WebGL2 leg on a fresh
  // canvas. When both fail, the page uses the fade cover from now on.
  const ensure_backend = () => {
    if (backend || shader_failed) return Promise.resolve(backend);
    if (opening) return opening;

    opening = (async () => {
      let canvas = document_value.createElement("canvas");
      place(canvas);
      show(canvas, "shader");
      const errors = [];
      for (const kind of ["webgpu", "webgl2"]) {
        try {
          const created = await open_backend(canvas, kind);
          if (created) {
            backend = created;
            element.dataset.follyTransitionBackend = created.backend;
            return backend;
          }
          return null;
        } catch (error) {
          errors.push(error);
          if (disposed) return null;
          canvas = fresh_canvas(canvas);
          element = canvas;
        }
      }
      shader_failed = true;
      canvas.remove();
      element = null;
      console.warn(
        "[folly] transition cover fell back to fade",
        new AggregateError(errors, "no GPU leg opened the cover shader"),
      );
      return null;
    })().finally(() => {
      opening = null;
    });
    return opening;
  };

  const ensure_fade = () => {
    if (element?.dataset.follyTransition === "fade") return element;

    const sheet = document_value.createElement("div");
    place(sheet);
    show(sheet, "fade");
    return sheet;
  };

  const draw = async () => {
    const { phase, progress, origin, seed, palette, started } = current;
    if (element.dataset.follyTransition === "fade") {
      const [red, green, blue] = palette.paper.map((value) => value * 255);
      element.style.background = `rgb(${red}, ${green}, ${blue})`;
      element.style.opacity = String(
        phase === "cover" ? progress : 1 - progress,
      );
      return;
    }
    if (!backend) return;

    const size = size_canvas();
    await backend.render({
      paper: palette.paper,
      ink: palette.ink,
      size,
      origin,
      progress,
      phase: phase === "cover" ? 0 : 1,
      effect: COVER_EFFECTS[effect] ?? COVER_EFFECTS.ink,
      time: (view.performance.now() - started) / 1000,
      seed,
    });
  };

  const settle = () => {
    const finished = current;
    current = null;
    if (finished.phase === "reveal" && element) element.style.display = "none";
    finished.resolve();
    emit(
      finished.phase === "cover"
        ? "folly:transition-covered"
        : "folly:transition-revealed",
      { mode: finished.mode },
    );
  };

  const tick = () => {
    frame_request = 0;
    if (!current || disposed) return;

    const elapsed = view.performance.now() - current.started;
    const linear =
      current.duration > 0 ? clamp01(elapsed / current.duration) : 1;
    current.progress =
      current.phase === "cover" ? ease_in(linear) : ease_out(linear);

    if (!drawing && element) {
      drawing = true;
      const drawn = current;
      draw()
        .catch((error) => {
          console.warn("[folly] transition cover failed to draw", error);
          backend?.dispose();
          backend = null;
          shader_failed = true;
          if (current) {
            ensure_fade().style.display = "block";
            current.mode = "fade";
          }
        })
        .finally(() => {
          drawing = false;
          if (drawn !== current || !current) return;
          if (linear >= 1) settle();
        });
    }
    if (current && !(linear >= 1 && !drawing)) {
      frame_request = view.requestAnimationFrame(tick);
    }
  };

  const start = (phase, options = {}) => {
    const chosen = resolved_mode();
    const previous = current;
    previous?.resolve();

    return new Promise((resolve) => {
      if (chosen === "off" || disposed) {
        current = null;
        if (element) element.style.display = "none";
        resolve();
        return;
      }

      // A cover that starts during a reveal (or the reverse) continues from
      // the coverage already on screen.
      const carried =
        previous && previous.phase !== phase ? 1 - previous.progress : 0;
      const duration = phase === "cover" ? cover_ms : reveal_ms;
      current = {
        phase,
        mode: chosen,
        started: view.performance.now() - carried * duration,
        duration,
        progress: carried,
        origin: options.origin ?? previous?.origin ?? [0.5, 0.35],
        seed: options.seed ?? previous?.seed ?? random_seed(),
        palette: colors(),
        resolve,
      };

      const prepared =
        chosen === "shader" ? ensure_backend() : Promise.resolve(ensure_fade());
      prepared.then(() => {
        if (!current || disposed) return;
        if (resolved_mode() === "fade") ensure_fade();
        current.mode = element?.dataset.follyTransition ?? current.mode;
        if (!element) return;

        element.style.display = "block";
        if (!frame_request) frame_request = view.requestAnimationFrame(tick);
      });
    });
  };

  return {
    // Closes the cover. `origin` is the viewport point, [0..1, 0..1], where
    // the cover starts. Resolves when the page is fully covered.
    cover: (options) => start("cover", options),
    // Opens the cover on the current page. Resolves when the page shows.
    reveal: (options) => start("reveal", options),
    // Covers, runs `change`, and reveals. `change` may return a promise.
    async run(change, options) {
      await start("cover", options);
      try {
        await change();
      } finally {
        await start("reveal", options);
      }
    },
    // Milliseconds until a running cover shows full coverage on screen; 0
    // when no cover is running.
    remaining_ms() {
      if (!current || current.phase !== "cover") return 0;
      const elapsed = view.performance.now() - current.started;
      return (
        Math.max(0, Math.ceil(current.duration - elapsed)) + PRESENT_MARGIN_MS
      );
    },
    get mode() {
      return resolved_mode();
    },
    // Opens the shader cover ahead of the first transition and draws one
    // empty frame, so the first click does not wait on a shader compile.
    async warm() {
      if (resolved_mode() !== "shader") return;
      if (!(await ensure_backend()) || current) return;

      size_canvas();
      const palette = colors();
      await backend.render({
        ...palette,
        size: [element.width, element.height],
        origin: [0.5, 0.35],
        progress: 0,
        phase: 0,
        effect: COVER_EFFECTS[effect] ?? COVER_EFFECTS.ink,
        time: 0,
        seed: 0,
      });
    },
    dispose() {
      disposed = true;
      if (frame_request) view.cancelAnimationFrame(frame_request);
      current?.resolve();
      current = null;
      backend?.dispose();
      backend = null;
      element?.remove();
      element = null;
    },
  };
}

// htmx swap specs are space-separated; the swap delay is the `swap:` token.
export const with_swap_delay = (spec, delay_ms) => {
  const tokens = String(spec ?? "")
    .split(/\s+/u)
    .filter((token) => token && !token.startsWith("swap:"));
  return [...tokens, `swap:${Math.max(0, Math.round(delay_ms))}ms`].join(" ");
};

const inherited_swap = (htmx, element) => {
  const owner = element && htmx.closest(element, "[hx-swap],[data-hx-swap]");
  return (
    owner?.getAttribute("hx-swap") ?? owner?.getAttribute("data-hx-swap") ?? ""
  );
};

const origin_of = (element, view) => {
  const rect = element?.getBoundingClientRect?.();
  if (!rect || (!rect.width && !rect.height)) return undefined;

  return [
    clamp01((rect.left + rect.width / 2) / Math.max(1, view.innerWidth)),
    clamp01((rect.top + rect.height / 2) / Math.max(1, view.innerHeight)),
  ];
};

// Plays the transition on every htmx navigation that swaps `target`. The cover
// starts with the request, and the swap waits until the page is covered. The
// reveal starts after the new content swaps in and `ready()` resolves. A failed
// request, or a response that swaps nothing, reveals the old page again.
export function bind_htmx_navigation(
  htmx,
  transition,
  {
    target,
    ready = () => Promise.resolve(),
    max_wait_ms = 15000,
    document: document_value = globalThis.document,
  } = {},
) {
  if (htmx[HTMX_BOUND]) return htmx[HTMX_BOUND];

  const view = document_value.defaultView;
  const target_of = (detail) =>
    detail?.target ?? detail?.requestConfig?.target ?? null;
  const ours = (detail) => {
    const element = target_of(detail);
    return Boolean(element?.matches?.(target));
  };

  // { swapping, timer } for the navigation in flight.
  let pending = null;

  const finish = async (wait_for_ready) => {
    const finished = pending;
    if (!finished) return;

    pending = null;
    view.clearTimeout(finished.timer);
    if (wait_for_ready) {
      try {
        await ready();
      } catch (error) {
        console.warn("[folly] transition ready check failed", error);
      }
    }
    if (pending) return;
    await transition.reveal();
  };

  const listeners = {
    "htmx:beforeRequest"(event) {
      const detail = event.detail;
      if (detail?.requestConfig?.headers?.["HX-Preloaded"] === "true") return;
      if (!ours(detail)) return;

      if (pending) view.clearTimeout(pending.timer);
      pending = {
        swapping: false,
        timer: view.setTimeout(() => finish(false), max_wait_ms),
      };
      transition.cover({ origin: origin_of(detail.elt, view) });
    },
    "htmx:beforeSwap"(event) {
      const detail = event.detail;
      if (!pending || !detail?.shouldSwap || !ours(detail)) return;

      const spec =
        detail.swapOverride ??
        inherited_swap(htmx, detail.requestConfig?.elt ?? detail.elt);
      detail.swapOverride = with_swap_delay(spec, transition.remaining_ms());
      pending.swapping = true;
    },
    "htmx:afterRequest"(event) {
      if (!pending || pending.swapping) return;
      if (event.detail?.requestConfig?.headers?.["HX-Preloaded"] === "true")
        return;
      finish(false);
    },
    "htmx:afterSwap"() {
      if (pending?.swapping) finish(true);
    },
  };

  for (const [name, listener] of Object.entries(listeners)) {
    document_value.addEventListener(name, listener);
  }
  const binding = {
    unbind() {
      for (const [name, listener] of Object.entries(listeners)) {
        document_value.removeEventListener(name, listener);
      }
      delete htmx[HTMX_BOUND];
    },
  };
  htmx[HTMX_BOUND] = binding;
  return binding;
}
