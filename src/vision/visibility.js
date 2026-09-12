const finite_origin = (value) => (Number.isFinite(value) ? value : 0);
const finite_edge = (value, origin, size) =>
  Number.isFinite(value) ? value : origin + (size || 0);

const viewport_size = () => ({
  width: globalThis.window?.innerWidth ?? 0,
  height: globalThis.window?.innerHeight ?? 0,
});

export const owner_intersects_viewport = (owner) => {
  if (typeof owner?.getBoundingClientRect !== "function") return true;
  const rect = owner.getBoundingClientRect();
  const { width, height } = viewport_size();
  if (!width || !height) return true;
  const left = finite_origin(rect.left);
  const top = finite_origin(rect.top);
  const right = finite_edge(rect.right, left, rect.width);
  const bottom = finite_edge(rect.bottom, top, rect.height);
  return bottom >= 0 && right >= 0 && top <= height && left <= width;
};

export const observe_effect_visibility = (
  owner,
  state,
  listener_cleanups,
  update_activity,
) => {
  if (typeof globalThis.IntersectionObserver === "function") {
    state.intersection_observer = new globalThis.IntersectionObserver(
      (entries) => {
        const owner_entry = entries.find((entry) => entry.target === owner);
        if (!owner_entry) return;
        state.owner_visible = owner_entry.isIntersecting === true;
        update_activity();
      },
    );
    state.intersection_observer.observe(owner);
  }

  if (typeof globalThis.document?.addEventListener === "function") {
    const handle_visibility = () => {
      state.document_visible = document.visibilityState !== "hidden";
      update_activity();
    };
    document.addEventListener("visibilitychange", handle_visibility);
    listener_cleanups.push(() =>
      document.removeEventListener("visibilitychange", handle_visibility),
    );
  }
};

export const observe_effect_size = (
  owner,
  canvas,
  state,
  listener_cleanups,
  handle_resize,
) => {
  if (typeof globalThis.ResizeObserver === "function") {
    state.resize_observer = new globalThis.ResizeObserver(handle_resize);
    state.resize_observer.observe(owner ?? canvas);
  }
  if (typeof globalThis.window?.addEventListener === "function") {
    globalThis.window.addEventListener("resize", handle_resize, {
      passive: true,
    });
    listener_cleanups.push(() =>
      globalThis.window.removeEventListener("resize", handle_resize),
    );
  }
};

export const disconnect_effect_observers = (state, listener_cleanups) => {
  state.intersection_observer?.disconnect();
  state.intersection_observer = null;
  state.resize_observer?.disconnect();
  state.resize_observer = null;
  for (const cleanup_listener of listener_cleanups.splice(0)) {
    try {
      cleanup_listener();
    } catch {
      // Continue releasing the remaining effect and renderer resources.
    }
  }
};
