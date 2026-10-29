// Page transitions: one ring of ink grows from the link the reader clicked,
// and the new page shows inside the ring. The View Transitions API keeps a
// picture of the old page; the ring clips the live new page over it.
//
//   const transition = create_page_transition({ mode: () => "ink" });
//   await transition.run(() => apply_new_state(), { origin: [0.5, 0.3] });
//   bind_htmx_navigation(htmx, transition, { target: "#page" });
//
// Modes: "ink" grows the ring. "fade" cross-fades the two pages. "off"
// changes the page at once. Reduced motion, and a browser without View
// Transitions, always mean "off".
//
// The ring is a band of ink with the clip line of the new page at its middle.
// A host can draw the band itself: `open_painter(canvas)` resolves to
// `{ draw(frame), dispose() }`. `draw` must cover the line with opaque ink and
// stay within `width * 2` of it. Until the painter opens, and after it fails,
// the ring draws a soft band on a 2D canvas.
export const TRANSITION_MODES = Object.freeze(["ink", "fade", "off"]);

const STYLE_ID = "folly-transition-style";
const RING_CLASS = "folly-transition-ring";
const ACTIVE_ATTRIBUTE = "data-folly-ring-active";
const CLIP_PROPERTY = "--folly-transition-clip";
const MS_PROPERTY = "--folly-transition-ms";
const HTMX_BOUND = Symbol.for("scripts-of-folly.transitions.htmx");
const MAX_PIXEL_RATIO = 2;
const EMPTY_CLIP = "circle(0px at 50% 50%)";

// One stylesheet for every transition on the page. A class on <html> picks
// the mode. The ring layer has its own view-transition-name, so the live
// ring paints over the two pictures of the page.
const STYLE = `
::view-transition { pointer-events: none; }
.${RING_CLASS} { display: none; }
.${RING_CLASS} > canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: none;
}
.${RING_CLASS} > canvas[${ACTIVE_ATTRIBUTE}] { display: block; }
html.folly-transition-ink::view-transition-old(root),
html.folly-transition-ink::view-transition-new(root) { animation: none; }
html.folly-transition-ink::view-transition-new(root) {
  clip-path: var(${CLIP_PROPERTY}, ${EMPTY_CLIP});
}
html.folly-transition-ink::view-transition-group(folly-transition-ring),
html.folly-transition-ink::view-transition-new(folly-transition-ring) {
  animation: none;
}
html.folly-transition-ink::view-transition-old(folly-transition-ring) {
  display: none;
}
html.folly-transition-ink .${RING_CLASS} {
  display: block;
  view-transition-name: folly-transition-ring;
}
html.folly-transition-fade::view-transition-old(root),
html.folly-transition-fade::view-transition-new(root) {
  animation-duration: var(${MS_PROPERTY});
}
`;

const ease_in_out = (value) => 0.5 - Math.cos(Math.PI * value) / 2;
const clamp01 = (value) => Math.min(1, Math.max(0, value));

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

// The paper and ink of `element`: its background and text colour. Pass the
// element that holds the reading text when the body colours differ.
export const colors_of = (element) => {
  const document_value = element.ownerDocument;
  const style = document_value.defaultView.getComputedStyle(element);
  return {
    paper: read_rgb(document_value, style.backgroundColor),
    ink: read_rgb(document_value, style.color),
  };
};

// The 2D ring: a soft band of ink, opaque at the line. It needs no GPU, so
// it draws the first click and the clicks after a painter fails.
const create_soft_painter = (canvas, view, colors) => ({
  canvas,
  draw({ x, y, radius, width, view_width, view_height }) {
    const ratio = Math.min(MAX_PIXEL_RATIO, view.devicePixelRatio || 1);
    const pixel_width = Math.max(1, Math.round(view_width * ratio));
    const pixel_height = Math.max(1, Math.round(view_height * ratio));
    if (canvas.width !== pixel_width || canvas.height !== pixel_height) {
      canvas.width = pixel_width;
      canvas.height = pixel_height;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, view_width, view_height);

    const [red, green, blue] = colors().ink.map((value) =>
      Math.round(value * 255),
    );
    context.strokeStyle = `rgb(${red}, ${green}, ${blue})`;
    // The blur softens each side by about a third of the band, so the stroke
    // stays opaque at the line.
    context.filter = `blur(${Math.round(width * 0.35)}px)`;
    context.lineWidth = width * 1.5;
    context.beginPath();
    context.arc(x, y, Math.max(0, radius), 0, Math.PI * 2);
    context.stroke();
    context.filter = "none";
  },
  dispose() {
    canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
  },
});

export function create_page_transition({
  document: document_value = globalThis.document,
  mode = () => "ink",
  ring_ms = 1600,
  fade_ms = 600,
  z_index = 50,
  // Half the ink band in CSS pixels, for a viewport of this size.
  ring_width = (view_width, view_height) =>
    Math.max(24, Math.min(view_width, view_height) * 0.06),
  open_painter = null,
  colors = () =>
    colors_of(document_value.body ?? document_value.documentElement),
} = {}) {
  const view = document_value.defaultView;
  const root = document_value.documentElement;
  const motion = view.matchMedia("(prefers-reduced-motion: reduce)");

  // The ring layer holds two canvases: the 2D one, and the host painter's.
  let layer = null;
  let soft = null;
  let painter = null;
  let opening = null;
  let painter_failed = false;
  // The running transition: { view_transition, frame }.
  let current = null;

  const resolved_mode = () => {
    if (motion.matches) return "off";
    if (typeof document_value.startViewTransition !== "function") return "off";
    const asked = mode();
    return TRANSITION_MODES.includes(asked) ? asked : "ink";
  };

  const emit = (name, detail) =>
    document_value.dispatchEvent(new view.CustomEvent(name, { detail }));

  const ensure_style = () => {
    if (document_value.getElementById(STYLE_ID)) return;
    const style = document_value.createElement("style");
    style.id = STYLE_ID;
    style.textContent = STYLE;
    document_value.head.append(style);
  };

  const ensure_layer = () => {
    if (layer?.isConnected) return;
    ensure_style();
    layer = document_value.createElement("div");
    layer.className = RING_CLASS;
    layer.setAttribute("aria-hidden", "true");
    Object.assign(layer.style, {
      position: "fixed",
      inset: "0",
      zIndex: String(z_index),
      pointerEvents: "none",
    });
    const soft_canvas = document_value.createElement("canvas");
    layer.append(soft_canvas);
    soft = create_soft_painter(soft_canvas, view, colors);
    document_value.body.append(layer);
  };

  const drop_painter = (error) => {
    console.warn("[folly] transition ring painter failed", error);
    painter_failed = true;
    painter?.dispose();
    painter?.canvas.remove();
    painter = null;
  };

  // Opens the host painter in the background. A transition never waits for
  // it: until it is open, the ring is the 2D band.
  const ensure_painter = () => {
    if (!open_painter || painter || painter_failed) return Promise.resolve();
    if (opening) return opening;
    ensure_layer();
    const canvas = document_value.createElement("canvas");
    layer.append(canvas);
    opening = (async () => {
      try {
        painter = { ...(await open_painter(canvas)), canvas };
      } catch (error) {
        canvas.remove();
        drop_painter(error);
      } finally {
        opening = null;
      }
    })();
    return opening;
  };

  const clean_up = () => {
    root.classList.remove("folly-transition-ink", "folly-transition-fade");
    root.style.removeProperty(CLIP_PROPERTY);
    root.style.removeProperty(MS_PROPERTY);
    soft?.canvas.removeAttribute(ACTIVE_ATTRIBUTE);
    painter?.canvas.removeAttribute(ACTIVE_ATTRIBUTE);
  };

  // The ring at `elapsed_ms`. The line starts at the origin and ends past
  // the farthest corner by the whole band, so the ink leaves the screen.
  const ring_at = (ring, elapsed_ms) => {
    const progress = clamp01(elapsed_ms / ring_ms);
    return {
      x: ring.x,
      y: ring.y,
      radius: (ring.reach + ring.width * 2) * ease_in_out(progress),
      width: ring.width,
      progress,
      seconds: ring.seconds + elapsed_ms / 1000,
      view_width: ring.view_width,
      view_height: ring.view_height,
    };
  };

  // Draws with the surface this run started on. A painter that fails mid-run
  // hands the rest of the ring to the 2D band.
  const draw = (ring, frame) => {
    if (ring.painter && ring.painter === painter) {
      try {
        ring.painter.draw(frame);
        return;
      } catch (error) {
        drop_painter(error);
        ring.painter = null;
        soft.canvas.setAttribute(ACTIVE_ATTRIBUTE, "");
      }
    }
    soft.draw(frame);
  };

  const play_ring = async (view_transition, ring) => {
    try {
      await view_transition.ready;
    } catch {
      // Not an error to handle here: the update failed or a newer transition
      // skipped this one, the page shows its final state, and run() reports
      // the outcome through `finished`.
      return;
    }
    // The pictures of the page have no animation of their own in this mode.
    // This empty animation keeps the transition open for the ring.
    root.animate([{ opacity: 1 }, { opacity: 1 }], {
      duration: ring_ms,
      pseudoElement: "::view-transition-new(root)",
    });

    const started = view.performance.now();
    const step = () => {
      if (current?.view_transition !== view_transition) return;
      const elapsed = view.performance.now() - started;
      const frame = ring_at(ring, elapsed);
      root.style.setProperty(
        CLIP_PROPERTY,
        `circle(${frame.radius.toFixed(1)}px at ${frame.x.toFixed(1)}px ${frame.y.toFixed(1)}px)`,
      );
      draw(ring, frame);
      if (elapsed < ring_ms) current.frame = view.requestAnimationFrame(step);
    };
    step();
  };

  return {
    mode: resolved_mode,

    // Opens the host painter before the first transition, and draws one
    // empty frame (width 0) with it. A host that waits for the first frame of
    // each GPU effect then knows the painter is ready.
    async warm() {
      if (resolved_mode() !== "ink") return;
      const first = !painter;
      await ensure_painter();
      if (!first || !painter || current) return;
      try {
        painter.draw({
          x: 0,
          y: 0,
          radius: 0,
          width: 0,
          progress: 0,
          seconds: 0,
          view_width: view.innerWidth,
          view_height: view.innerHeight,
        });
      } catch (error) {
        drop_painter(error);
      }
    },

    // Changes the page with `change` (it may return a promise) inside the
    // transition. `origin` is the viewport point, [0..1, 0..1], where the
    // ring starts. Resolves when the transition has finished.
    async run(change, { origin = [0.5, 0.35] } = {}) {
      const kind = resolved_mode();
      if (current) {
        view.cancelAnimationFrame(current.frame);
        current.view_transition.skipTransition();
      }
      if (kind === "off") {
        clean_up();
        current = null;
        await change();
        return;
      }

      ensure_layer();
      clean_up();
      let ring = null;
      if (kind === "ink") {
        ensure_painter();
        const view_width = view.innerWidth;
        const view_height = view.innerHeight;
        const x = clamp01(origin[0]) * view_width;
        const y = clamp01(origin[1]) * view_height;
        ring = {
          x,
          y,
          view_width,
          view_height,
          reach: Math.max(
            Math.hypot(x, y),
            Math.hypot(view_width - x, y),
            Math.hypot(x, view_height - y),
            Math.hypot(view_width - x, view_height - y),
          ),
          width: ring_width(view_width, view_height),
          // Each run starts the ink at a different place in its motion.
          seconds: Math.random() * 100,
          painter,
        };
        (painter ?? soft).canvas.setAttribute(ACTIVE_ATTRIBUTE, "");
        root.style.setProperty(CLIP_PROPERTY, EMPTY_CLIP);
      } else {
        root.style.setProperty(MS_PROPERTY, `${fade_ms}ms`);
      }
      root.classList.add(`folly-transition-${kind}`);

      const view_transition = document_value.startViewTransition(change);
      const running = { view_transition, frame: 0 };
      current = running;
      emit("folly:transition-started", {
        mode: kind,
        painter: ring?.painter ? "host" : "soft",
      });
      if (kind === "ink") play_ring(view_transition, ring);

      try {
        await view_transition.finished;
      } finally {
        if (current === running) {
          view.cancelAnimationFrame(running.frame);
          current = null;
          clean_up();
        }
        emit("folly:transition-finished", { mode: kind });
      }
    },

    dispose() {
      if (current) {
        view.cancelAnimationFrame(current.frame);
        current.view_transition.skipTransition();
        current = null;
      }
      clean_up();
      painter?.dispose();
      painter = null;
      soft?.dispose();
      layer?.remove();
      layer = null;
      document_value.getElementById(STYLE_ID)?.remove();
    },
  };
}

// The swap spec for a navigation: no swap or settle delay, inside a view
// transition. The swap style and the other tokens stay.
export const navigation_swap = (spec) => {
  const tokens = String(spec ?? "")
    .split(/\s+/u)
    .filter((token) => token && !/^(swap|settle|transition):/u.test(token));
  return [...tokens, "swap:0ms", "settle:0ms", "transition:true"].join(" ");
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
// request goes out at once. When the response arrives, the binding asks
// htmx to swap inside a view transition, and hands that view transition to
// `transition`, so the ring starts at the clicked link.
//
// htmx calls document.startViewTransition itself and keeps no reference to
// it. So at htmx:beforeTransition the binding puts a one-call
// startViewTransition on the document, which removes itself and runs
// `transition.run` with htmx's update.
//
// Back and forward: htmx restores `target` (its hx-history-elt) without a
// transition. The binding turns the transition on for that swap. The ring
// starts at the left edge for back and at the right edge for forward
// (centre when the browser has no Navigation API). htmx fires
// htmx:historyRestore right after it asks for the swap, before the view
// transition runs it. The binding holds that event and sends it again
// after the swap, so its listeners see the restored page.
const RESTORE_EVENTS = ["htmx:historyRestore", "htmx:history-restore"];

export function bind_htmx_navigation(
  htmx,
  transition,
  { target, document: document_value = globalThis.document } = {},
) {
  if (htmx[HTMX_BOUND]) return htmx[HTMX_BOUND];

  const view = document_value.defaultView;
  const target_of = (detail) =>
    detail?.target ?? detail?.requestConfig?.target ?? null;
  const ours = (detail) => Boolean(target_of(detail)?.matches?.(target));
  const preloaded = (detail) =>
    detail?.requestConfig?.headers?.["HX-Preloaded"] === "true";
  const navigation = view?.navigation;

  let origin;
  // The direction of the last back/forward step: -1 back, 1 forward.
  let traverse = 0;
  // A restore swap that waits in a view transition: { detail, done }.
  let restore = null;

  const on_entry_change = (event) => {
    if (event.navigationType !== "traverse") return;
    const from = event.from?.index ?? -1;
    const to = navigation.currentEntry?.index ?? -1;
    traverse = from < 0 || to < 0 ? 0 : Math.sign(to - from);
  };
  navigation?.addEventListener("currententrychange", on_entry_change);

  const on_restore_hit = (event) => {
    const detail = event.detail;
    if (!detail?.historyElt?.matches?.(target)) return;
    if (transition.mode() === "off") return;
    detail.swapSpec.transition = true;
    origin = traverse < 0 ? [0, 0.5] : traverse > 0 ? [1, 0.5] : undefined;
    traverse = 0;
    restore = { detail: null, done: false };
  };

  // Capture on the document: this runs before listeners on the body.
  const hold_restore = (event) => {
    if (!restore || restore.done || event.detail?.__folly_resent) return;
    event.stopImmediatePropagation();
    if (event.type === RESTORE_EVENTS[0]) restore.detail = event.detail;
  };

  const send_restore = (held) => {
    if (held.done) return;
    held.done = true;
    if (restore === held) restore = null;
    if (!held.detail) return;
    htmx.trigger(document_value.body, RESTORE_EVENTS[0], {
      ...held.detail,
      __folly_resent: true,
    });
  };

  const run_swap = (update, ring_origin) => {
    const held = restore;
    const change = held
      ? () => {
          const result = update();
          send_restore(held);
          return result;
        }
      : update;
    transition
      .run(change, { origin: ring_origin })
      .catch((error) => console.warn("[folly] page transition failed", error))
      .finally(() => held && send_restore(held));
  };

  const listeners = {
    "htmx:beforeSwap"(event) {
      const detail = event.detail;
      if (!detail?.shouldSwap || !ours(detail) || preloaded(detail)) return;
      const element = detail.requestConfig?.elt ?? detail.elt;
      origin = origin_of(element, view);
      detail.swapOverride = navigation_swap(
        detail.swapOverride ?? inherited_swap(htmx, element),
      );
    },
    "htmx:historyCacheHit": on_restore_hit,
    "htmx:historyCacheMissLoad": on_restore_hit,
    "htmx:beforeTransition"(event) {
      if (!ours(event.detail) && !restore) return;
      if (transition.mode() === "off") {
        // htmx then swaps without a view transition.
        event.preventDefault();
        restore = null;
        return;
      }
      const ring_origin = origin;
      origin = undefined;
      document_value.startViewTransition = (update) => {
        delete document_value.startViewTransition;
        run_swap(update, ring_origin);
      };
    },
  };

  for (const [name, listener] of Object.entries(listeners)) {
    document_value.addEventListener(name, listener);
  }
  for (const name of RESTORE_EVENTS) {
    document_value.addEventListener(name, hold_restore, true);
  }

  const binding = {
    unbind() {
      for (const [name, listener] of Object.entries(listeners)) {
        document_value.removeEventListener(name, listener);
      }
      for (const name of RESTORE_EVENTS) {
        document_value.removeEventListener(name, hold_restore, true);
      }
      navigation?.removeEventListener("currententrychange", on_entry_change);
      delete htmx[HTMX_BOUND];
    },
  };
  htmx[HTMX_BOUND] = binding;
  return binding;
}
