const PANEL_SELECTOR = ".sol__block_fx_terminal";
const TERMINAL_ELEMENT = "folly-terminal";
const TERMINAL_RUNTIME = Symbol.for("scripts-of-folly.terminal");
const CANVAS_CLASS = "folly-terminal-canvas";

export const DEFAULT_TERMINAL_GLYPHS = Object.freeze(
  [..."0123456789ABCDEF<>[]{}+-=*/"].map((text) =>
    Object.freeze({ text, font: "18px ui-monospace, monospace" }),
  ),
);

const clamp = (value, minimum, maximum) =>
  Math.min(maximum, Math.max(minimum, value));

const effect_seed = (effect_name = "terminal") => {
  let hash = 2166136261;

  for (const character of effect_name) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0) / 4294967295;
};

const frame_interval = (raw_limit) => {
  if (String(raw_limit).toLowerCase() === "display") return 0;

  const numeric_limit = Number(raw_limit);
  return Number.isFinite(numeric_limit) && numeric_limit > 0
    ? 1000 / numeric_limit
    : 1000 / 60;
};

const create_frame_gate = (
  read_limit = () => document.documentElement.dataset.siteFps,
) => {
  let deadline = null;
  let previous_interval = null;

  return {
    due(now) {
      const interval = frame_interval(read_limit());
      if (interval !== previous_interval) {
        deadline = null;
        previous_interval = interval;
      }

      if (interval === 0) return true;
      if (deadline === null) {
        deadline = now + interval;
        return true;
      }
      if (now + 0.25 < deadline) return false;

      deadline +=
        Math.max(1, Math.floor((now - deadline) / interval) + 1) * interval;
      return true;
    },
    reset() {
      deadline = null;
      previous_interval = null;
    },
  };
};

const load_terminal_gpu = async (canvas, options) => {
  const { create_terminal_gpu } = await import("./gpu.js");
  return create_terminal_gpu(canvas, options);
};

export const create_terminal_runtime = (host, canvas, options = {}) => {
  if (!(host instanceof HTMLElement)) {
    throw new TypeError("The Terminal host must be an HTML element.");
  }
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new TypeError("The Terminal canvas must be an HTML canvas element.");
  }
  if (host[TERMINAL_RUNTIME]) return host[TERMINAL_RUNTIME];

  const panel = host.querySelector(PANEL_SELECTOR);
  if (!(panel instanceof HTMLElement)) {
    throw new Error("The Terminal host requires one terminal effect panel.");
  }

  const glyphs = options.glyphs ?? DEFAULT_TERMINAL_GLYPHS;
  const load_gpu = options.load_gpu ?? load_terminal_gpu;
  const motion_query = matchMedia("(prefers-reduced-motion: reduce)");
  const frame_gate = create_frame_gate(options.read_frame_limit);
  const values = {
    resolution: [1, 1],
    time: 0,
    intensity: 1,
    motion: 1,
    scheme: 0,
    seed: effect_seed(
      host.dataset.follyTerminalSeed ??
        host.dataset.effectWindow ??
        panel.dataset.textFx,
    ),
    rune_count: 1,
    frame_inset: [16, 16],
    halo_radius: 12,
    frame_radius: 6,
  };
  let backend = null;
  let animation_frame = 0;
  let last_frame = null;
  let elapsed = 0;
  let pending = false;
  let disposed = false;
  let failed = false;
  let visible = true;
  let dirty = true;
  let needs_frame = true;

  host.dataset.follyTerminalRenderer = "static";

  const active = () =>
    !disposed && !failed && visible && host.isConnected && !document.hidden;

  const cancel = () => {
    if (animation_frame) cancelAnimationFrame(animation_frame);
    animation_frame = 0;
    last_frame = null;
    frame_gate.reset();
  };

  const release = () => {
    const current = backend;
    backend = null;
    current?.dispose();
  };

  const fail = (error) => {
    if (disposed || failed) return;

    failed = true;
    cancel();
    host.dataset.follyTerminalRenderer = "static";
    host.dataset.follyTerminalError =
      error instanceof Error ? error.message : String(error);
    console.error("[scripts-of-folly/terminal] VGPU runtime failed", error);
    release();
  };

  const measure = () => {
    const canvas_bounds = canvas.getBoundingClientRect();
    const panel_bounds = panel.getBoundingClientRect();
    const style = getComputedStyle(panel);
    const marker_intensity =
      Number.parseFloat(
        style.getPropertyValue("--block_fx_marker_intensity"),
      ) || 1;
    const glow_multiplier =
      Number.parseFloat(style.getPropertyValue("--site_fx_glow_mult")) || 1;
    const scheme = Number.parseFloat(
      style.getPropertyValue("--folly_terminal_scheme"),
    );

    values.resolution[0] = canvas_bounds.width;
    values.resolution[1] = canvas_bounds.height;
    values.frame_inset[0] = Math.max(0, panel_bounds.left - canvas_bounds.left);
    values.frame_inset[1] = Math.max(0, panel_bounds.top - canvas_bounds.top);
    values.halo_radius =
      Number.parseFloat(
        style.getPropertyValue("--folly_terminal_halo_radius"),
      ) || 0;
    values.frame_radius = Number.parseFloat(style.borderTopLeftRadius) || 0;
    values.intensity = clamp(marker_intensity * glow_multiplier, 0.2, 2);
    values.motion = clamp(
      Number.parseFloat(style.getPropertyValue("--site_fx_motion_mult")) || 1,
      0.2,
      2,
    );
    values.scheme = Number.isFinite(scheme) ? clamp(scheme, 0, 1) : 0;
    dirty = false;
  };

  const update_time = (now) => {
    if (!motion_query.matches && last_frame !== null) {
      elapsed += now - last_frame;
    }
    last_frame = now;
    values.time = motion_query.matches ? 0 : elapsed / 1000;
  };

  const request = () => {
    if (!active() || !backend || animation_frame) return;
    if (motion_query.matches && !needs_frame) return;

    animation_frame = requestAnimationFrame((now) => {
      animation_frame = 0;
      draw(now);
    });
  };

  const render = () => {
    try {
      backend.render(values);
    } catch (error) {
      fail(error);
      return;
    }

    host.dataset.follyTerminalRenderer = "vgpu";
    needs_frame = false;
    if (!motion_query.matches) request();
  };

  function draw(now) {
    if (!active() || !backend) {
      cancel();
      return;
    }
    if (!motion_query.matches && !frame_gate.due(now)) {
      request();
      return;
    }

    if (dirty) measure();
    if (values.resolution[0] <= 0 || values.resolution[1] <= 0) return;

    update_time(now);
    render();
  }

  const initialize = async () => {
    if (pending || backend || !active()) return;

    pending = true;
    host.dataset.follyTerminalRenderer = "loading";
    delete host.dataset.follyTerminalError;

    try {
      const loaded = await load_gpu(canvas, {
        glyphs,
        on_error: fail,
        on_state: (state) => {
          host.dataset.follyTerminalGpuState = state;
        },
      });
      if (disposed || failed) {
        loaded.dispose();
        return;
      }

      backend = loaded;
      values.rune_count = loaded.rune_count;
      dirty = true;
      needs_frame = true;
      request();
    } catch (error) {
      fail(error);
    } finally {
      pending = false;
    }
  };

  const sync = () => {
    if (!active()) {
      cancel();
      return;
    }

    if (backend) request();
    else void initialize();
  };

  const invalidate = () => {
    if (disposed || failed) return;

    dirty = true;
    needs_frame = true;
    sync();
  };

  const motion_change = () => {
    if (disposed || failed) return;

    cancel();
    invalidate();
  };

  const resize_observer = new ResizeObserver(invalidate);
  resize_observer.observe(host);
  resize_observer.observe(canvas);

  const intersection_observer =
    typeof IntersectionObserver === "function"
      ? new IntersectionObserver(
          ([entry]) => {
            visible = entry?.isIntersecting === true;
            sync();
          },
          { rootMargin: "160px" },
        )
      : null;
  intersection_observer?.observe(host);

  const display_observer = new MutationObserver(invalidate);
  display_observer.observe(document.documentElement, { attributes: true });

  motion_query.addEventListener("change", motion_change);
  document.addEventListener("visibilitychange", sync);

  const controller = {
    dispose() {
      if (disposed) return;

      disposed = true;
      cancel();
      resize_observer.disconnect();
      intersection_observer?.disconnect();
      display_observer.disconnect();
      motion_query.removeEventListener("change", motion_change);
      document.removeEventListener("visibilitychange", sync);
      release();
      host.dataset.follyTerminalRenderer = "static";
      host[TERMINAL_RUNTIME] = null;
    },
  };
  host[TERMINAL_RUNTIME] = controller;
  sync();

  return controller;
};

const define_terminal_element = () => {
  if (customElements.get(TERMINAL_ELEMENT)) return;

  customElements.define(
    TERMINAL_ELEMENT,
    class extends HTMLElement {
      connectedCallback() {
        if (this[TERMINAL_RUNTIME]) return;

        const panel = this.querySelector(PANEL_SELECTOR);
        if (!(panel instanceof HTMLElement)) return;

        let canvas = this.querySelector(`:scope > .${CANVAS_CLASS}`);
        if (!(canvas instanceof HTMLCanvasElement)) {
          canvas = document.createElement("canvas");
          canvas.className = CANVAS_CLASS;
          canvas.setAttribute("aria-hidden", "true");
          this.prepend(canvas);
        }
        create_terminal_runtime(this, canvas);
      }

      disconnectedCallback() {
        this[TERMINAL_RUNTIME]?.dispose();
      }
    },
  );
};

const terminal_panels_in = (root) => {
  const panels = Array.from(root.querySelectorAll?.(PANEL_SELECTOR) ?? []);
  if (root.matches?.(PANEL_SELECTOR)) panels.unshift(root);
  return panels;
};

export const hydrate_terminal_effects = (root = document) => {
  define_terminal_element();

  for (const panel of terminal_panels_in(root)) {
    if (panel.closest(`${TERMINAL_ELEMENT}, sol-effect-window`)) continue;

    const parent = panel.parentNode;
    if (!parent) continue;

    const next_sibling = panel.nextSibling;
    const host = document.createElement(TERMINAL_ELEMENT);
    host.append(panel);
    parent.insertBefore(host, next_sibling);
  }
};
