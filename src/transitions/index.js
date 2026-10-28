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
// The cover is soft noise, so it renders at half the CSS size and the canvas
// scales it up. This is a quarter of the GPU work of a full-size cover.
const RENDER_SCALE = 0.5;
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

// The cover's paper and ink: the background and text colour of `element`.
// Pass the element that holds the reading text when the body colours differ.
export const colors_of = (element) => {
  const document_value = element.ownerDocument;
  const style = document_value.defaultView.getComputedStyle(element);
  return {
    paper: read_rgb(document_value, style.backgroundColor),
    ink: read_rgb(document_value, style.color),
  };
};

const page_colors = (document_value) =>
  colors_of(document_value.body ?? document_value.documentElement);

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

  // Two cover surfaces. The canvas belongs to the shader backend and opens in
  // the background. The sheet is a plain element for the fade mode.
  let canvas = null;
  let sheet = null;
  // The kind of the cover on screen ("shader" or "fade"), or null.
  let on_screen = null;
  let backend = null;
  let opening = null;
  let shader_failed = false;
  let disposed = false;

  // One running animation at a time: { phase, mode, started, duration,
  // progress, origin, seed, palette, resolve }.
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

  const place = (node, kind) => {
    node.className = COVER_CLASS;
    node.dataset.follyTransition = kind;
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
    document_value.body.append(node);
  };

  const hide_all = () => {
    for (const node of [canvas, sheet]) if (node) node.style.display = "none";
    on_screen = null;
  };

  const show = (kind) => {
    const node = kind === "shader" ? canvas : sheet;
    for (const other of [canvas, sheet]) {
      if (other && other !== node) other.style.display = "none";
    }
    node.style.display = "block";
    on_screen = kind;
  };

  const ensure_fade = () => {
    if (!sheet) {
      sheet = document_value.createElement("div");
      place(sheet, "fade");
      sheet.style.opacity = "0";
    }
    return sheet;
  };

  // The sheet's look for an animation step: paper at the coverage on screen.
  const paint_sheet = ({ phase, progress, palette }) => {
    const [red, green, blue] = palette.paper.map((value) => value * 255);
    sheet.style.background = `rgb(${red}, ${green}, ${blue})`;
    sheet.style.opacity = String(phase === "cover" ? progress : 1 - progress);
  };

  // Moves the running transition to the fade sheet, at its current progress.
  const use_fade = () => {
    if (!current) return;
    ensure_fade();
    current.mode = "fade";
    paint_sheet(current);
    show("fade");
  };

  const size_canvas = () => {
    const width = Math.max(1, Math.round(view.innerWidth * RENDER_SCALE));
    const height = Math.max(1, Math.round(view.innerHeight * RENDER_SCALE));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    backend.resize(width, height);
    return [width, height];
  };

  const open_backend = async (node, kind) => {
    const opened = await open_gpu(kind);
    return create_cover_backend(node, opened, {
      is_alive: () => !disposed,
      on_lost: (reason) => {
        console.warn("[folly] transition cover lost its GPU device", reason);
        backend?.dispose();
        backend = null;
        if (current?.mode === "shader") use_fade();
      },
    });
  };

  // Opens the shader cover: WebGPU first, then the WebGL2 leg on a fresh
  // canvas. When both fail, the page uses the fade cover from now on.
  const ensure_backend = () => {
    if (backend || shader_failed) return Promise.resolve(backend);
    if (opening) return opening;

    opening = (async () => {
      let node = document_value.createElement("canvas");
      place(node, "shader");
      const errors = [];
      for (const kind of ["webgpu", "webgl2"]) {
        try {
          const created = await open_backend(node, kind);
          if (!created) {
            node.remove();
            return null;
          }
          canvas?.remove();
          canvas = node;
          backend = created;
          canvas.dataset.follyTransitionBackend = created.backend;
          return backend;
        } catch (error) {
          errors.push(error);
          if (disposed) {
            node.remove();
            return null;
          }
          node = fresh_canvas(node);
        }
      }
      shader_failed = true;
      node.remove();
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

  const draw = async () => {
    const {
      phase,
      mode: kind,
      progress,
      origin,
      seed,
      palette,
      started,
    } = current;
    if (kind === "fade") {
      paint_sheet(current);
      return;
    }
    if (!backend) return;

    await backend.render({
      paper: palette.paper,
      ink: palette.ink,
      size: size_canvas(),
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
    if (finished.phase === "reveal") hide_all();
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

    if (!drawing) {
      drawing = true;
      const drawn = current;
      draw()
        .catch((error) => {
          console.warn("[folly] transition cover failed to draw", error);
          backend?.dispose();
          backend = null;
          shader_failed = true;
          use_fade();
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

  // The surface for a new animation. A transition keeps its surface from
  // cover to reveal. A shader cover that is not open yet never delays a page
  // change: this transition plays on the fade sheet, and the shader opens in
  // the background for the next one.
  const surface_for = (asked, previous) => {
    const continuing = previous?.mode ?? on_screen;
    if (continuing === "fade" || (continuing === "shader" && backend))
      return continuing;
    if (asked !== "shader") return asked;
    if (backend) return "shader";
    ensure_backend();
    return "fade";
  };

  const start = (phase, options = {}) => {
    const asked = resolved_mode();
    const previous = current;
    previous?.resolve();

    return new Promise((resolve) => {
      if (asked === "off" || disposed) {
        current = null;
        hide_all();
        resolve();
        return;
      }

      const kind = surface_for(asked, previous);
      if (kind === "fade") ensure_fade();
      // A cover that starts during a reveal (or the reverse) continues from
      // the coverage already on screen.
      const carried =
        previous && previous.phase !== phase ? 1 - previous.progress : 0;
      const duration = phase === "cover" ? cover_ms : reveal_ms;
      current = {
        phase,
        mode: kind,
        started: view.performance.now() - carried * duration,
        duration,
        progress: carried,
        origin: options.origin ?? previous?.origin ?? [0.5, 0.35],
        seed: options.seed ?? previous?.seed ?? random_seed(),
        palette: colors(),
        resolve,
      };
      if (kind === "fade") paint_sheet(current);
      show(kind);
      if (!frame_request) frame_request = view.requestAnimationFrame(tick);
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
    // Closes a running cover at once on the fade sheet, at full coverage.
    // For a host that cannot wait longer for a slow GPU.
    close_now() {
      if (current?.phase !== "cover") return;

      use_fade();
      current.progress = 1;
      paint_sheet(current);
      settle();
    },
    get mode() {
      return resolved_mode();
    },
    // Opens the shader cover and draws one empty frame, so that the next
    // transition can use the shader.
    async warm() {
      if (resolved_mode() !== "shader") return;
      if (!(await ensure_backend()) || current) return;

      await backend.render({
        ...colors(),
        size: size_canvas(),
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
      canvas?.remove();
      sheet?.remove();
      canvas = null;
      sheet = null;
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

// Plays the transition on every htmx navigation that swaps `target`. The
// binding holds the request (htmx:confirm) until the cover is closed, so the
// swap always occurs under a closed cover. A page change never waits longer
// than `max_hold_ms` for the cover: then the request goes out anyway. The
// cover opens after the new content swaps in and `ready()` resolves. A failed
// request, or a response that swaps nothing, opens the cover on the old page.
export function bind_htmx_navigation(
  htmx,
  transition,
  {
    target,
    ready = () => Promise.resolve(),
    max_hold_ms = 2000,
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

  // { swapping, hold, timer } for the navigation in flight.
  let pending = null;

  const finish = async (wait_for_ready) => {
    const finished = pending;
    if (!finished) return;

    pending = null;
    view.clearTimeout(finished.hold);
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
    "htmx:confirm"(event) {
      const detail = event.detail;
      if (detail?.etc?.headers?.["HX-Preloaded"] === "true") return;
      // htmx asks an hx-confirm question after this event; holding the
      // request would skip it.
      if (detail?.question) return;
      if (!ours(detail)) return;

      event.preventDefault();
      if (pending) {
        view.clearTimeout(pending.hold);
        view.clearTimeout(pending.timer);
      }
      const navigation = { swapping: false, sent: false };
      // Only the latest navigation sends its request, and only once.
      const send = () => {
        if (pending !== navigation || navigation.sent) return;
        navigation.sent = true;
        view.clearTimeout(navigation.hold);
        detail.issueRequest(true);
      };
      // A GPU too slow to close the cover in time: snap it shut on the fade
      // sheet, so the swap is still hidden, and send the request.
      navigation.hold = view.setTimeout(() => {
        transition.close_now?.();
        send();
      }, max_hold_ms);
      navigation.timer = view.setTimeout(() => finish(false), max_wait_ms);
      pending = navigation;
      transition.cover({ origin: origin_of(detail.elt, view) }).then(send);
    },
    "htmx:beforeSwap"(event) {
      const detail = event.detail;
      if (!pending || !detail?.shouldSwap || !ours(detail)) return;

      const spec =
        detail.swapOverride ??
        inherited_swap(htmx, detail.requestConfig?.elt ?? detail.elt);
      detail.swapOverride = with_swap_delay(spec, 0);
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
