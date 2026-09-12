import { layout_pretext_root, reset_pretext_source } from "./index.js";

const active_generation = new WeakMap();
const active_animations = new WeakMap();
const active_shaders = new WeakMap();

const random_between = (minimum, maximum) =>
  minimum + Math.random() * (maximum - minimum);

const duration_options = (duration, delay = 0, easing) => ({
  duration,
  delay,
  easing,
  fill: "both",
});

export const PRETEXT_TRANSITION_EFFECTS = Object.freeze({
  dust: Object.freeze({
    out: () => ({
      keyframes: [
        {
          opacity: 1,
          transform: "translate(0, 0) rotate(0deg)",
          filter: "blur(0px)",
        },
        {
          opacity: 0,
          transform: `translate(${random_between(-14, 14)}px, ${random_between(-18, -2)}px) rotate(${random_between(-8, 8)}deg)`,
          filter: "blur(6px)",
        },
      ],
      options: duration_options(520, 0, "ease-in"),
    }),
    in: () => ({
      keyframes: [
        {
          opacity: 0,
          transform: `translate(${random_between(-14, 14)}px, ${random_between(-18, -2)}px) rotate(${random_between(-8, 8)}deg)`,
          filter: "blur(6px)",
        },
        {
          opacity: 1,
          transform: "translate(0, 0) rotate(0deg)",
          filter: "blur(0px)",
        },
      ],
      options: duration_options(560, 0, "cubic-bezier(0.16, 1.2, 0.3, 1)"),
    }),
  }),
  fog: Object.freeze({
    out: () => ({
      keyframes: [
        {
          opacity: 1,
          transform: "translateX(0) scale(1)",
          filter: "blur(0px)",
        },
        {
          opacity: 0,
          transform: "translateX(18px) scale(1.04)",
          filter: "blur(10px)",
        },
      ],
      options: duration_options(520, 0, "ease-in"),
    }),
    in: () => ({
      keyframes: [
        {
          opacity: 0,
          transform: "translateX(14px) scale(1.02)",
          filter: "blur(8px)",
        },
        {
          opacity: 1,
          transform: "translateX(0) scale(1)",
          filter: "blur(0px)",
        },
      ],
      options: duration_options(560, 0, "ease-out"),
    }),
  }),
});

const reduced_motion = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const motion_multiplier = (root) => {
  const view = root.ownerDocument.defaultView;
  const value = Number.parseFloat(
    view.getComputedStyle(root).getPropertyValue("--site_fx_motion_mult"),
  );

  return Number.isFinite(value) && value > 0 ? value : 1;
};

const resolve_transition_effect = (name) =>
  PRETEXT_TRANSITION_EFFECTS[name] ?? PRETEXT_TRANSITION_EFFECTS.dust;

const transition_timing = (options) => ({
  out_ms: options.out_ms ?? 520,
  in_ms: options.in_ms ?? 560,
  stagger_ms: options.stagger_ms ?? 14,
});

const can_animate = (fragments) =>
  fragments.every((fragment) => typeof fragment.animate === "function");

const emit = (root, name) => {
  const view = root.ownerDocument.defaultView;
  if (typeof view?.CustomEvent !== "function") return;

  root.dispatchEvent(
    new view.CustomEvent(name, { bubbles: true, detail: { root } }),
  );
};

const cancel_animations = (root) => {
  active_shaders.get(root)?.abort();
  active_shaders.delete(root);

  for (const animation of active_animations.get(root) ?? []) animation.cancel();
  active_animations.delete(root);

  if (typeof root.getAnimations === "function") {
    for (const animation of root.getAnimations({ subtree: true }))
      animation.cancel();
  }
};

const begin_transition = (root) => {
  cancel_animations(root);

  const generation = (active_generation.get(root) ?? 0) + 1;
  active_generation.set(root, generation);

  root.classList.add("sol__pretext_transitioning");
  emit(root, "folly:pretext-before-layout");

  return generation;
};

const animate_fragments = async (
  root,
  fragments,
  effect,
  phase,
  duration,
  stagger,
  multiplier,
  generation,
) => {
  const animations = [];
  active_animations.set(root, animations);

  for (let index = 0; index < fragments.length; index += 1) {
    if (active_generation.get(root) !== generation) return false;

    const result = effect[phase](fragments[index], index, fragments.length);
    const animation = fragments[index].animate(result.keyframes, {
      ...result.options,
      duration: duration * multiplier,
      delay: index * stagger * multiplier,
    });
    animations.push(animation);
  }

  await Promise.all(
    animations.map((animation) => animation.finished.catch(() => undefined)),
  );

  return active_generation.get(root) === generation;
};

const replace_pretext_content = (root, next_html, on_swap) => {
  root.innerHTML = String(next_html ?? "");
  reset_pretext_source(root, { restore: false });

  if (typeof on_swap === "function") on_swap(root);
  layout_pretext_root(root);
};

export const transition_pretext_content = async (
  root,
  next_html,
  options = {},
) => {
  if (!root || root.nodeType !== 1) return false;

  const generation = begin_transition(root);
  const controller = new AbortController();
  active_shaders.set(root, controller);
  let shader = null;

  const current = () =>
    active_generation.get(root) === generation && !controller.signal.aborted;

  try {
    const name = options.effect === "fog" ? "fog" : "dust";
    const effect = resolve_transition_effect(name);
    const { out_ms, in_ms, stagger_ms } = transition_timing(options);
    const multiplier = motion_multiplier(root);
    const current_fragments = Array.from(
      root.querySelectorAll(".sol__pretext_fragment"),
    );
    const instant = reduced_motion() || current_fragments.length === 0;

    if (!instant && root.isConnected) {
      const { create_shader_transition } =
        await import("./shader_transition.js");
      if (!current()) return false;

      shader = create_shader_transition(root, {
        backend: options.backend ?? "auto",
        signal: controller.signal,
      });
    }

    const run_phase = async (fragments, phase, duration) => {
      if (!current()) return false;
      if (reduced_motion() || root.ownerDocument.hidden) return true;

      if (shader) {
        try {
          return await shader.play(fragments, {
            phase,
            effect: name,
            duration,
            stagger: stagger_ms,
            multiplier,
          });
        } catch (error) {
          shader.dispose();
          shader = null;
          if (!current()) return false;

          console.warn(
            "Folly shader transition unavailable; using native animation.",
            error,
          );
        }
      }

      if (!can_animate(fragments)) return true;

      return animate_fragments(
        root,
        fragments,
        effect,
        phase,
        duration,
        stagger_ms,
        multiplier,
        generation,
      );
    };

    if (!instant && !(await run_phase(current_fragments, "out", out_ms)))
      return false;
    if (!current()) return false;

    replace_pretext_content(root, next_html, options.on_swap);
    // Pretext's queued mutation refresh must finish before the incoming capture.
    await new Promise(queueMicrotask);
    if (!current()) return false;

    const next_fragments = Array.from(
      root.querySelectorAll(".sol__pretext_fragment"),
    );
    if (!instant && !(await run_phase(next_fragments, "in", in_ms)))
      return false;

    return current();
  } finally {
    shader?.dispose();

    if (active_generation.get(root) === generation) {
      cancel_animations(root);
      root.classList.remove("sol__pretext_transitioning");
      emit(root, "folly:pretext-layout");
    }
  }
};
