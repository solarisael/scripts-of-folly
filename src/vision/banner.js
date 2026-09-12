import { create_gpu_effect_runtime } from "./runtime.js";
import {
  create_banner_images,
  listen_for_image,
  update_banner_image,
} from "./images.js";
import { observe_banner_viewport } from "./viewport.js";

const BANNER_SELECTOR = "[data-sol-vision-banner]";
const CANVAS_SELECTOR = "[data-sol-vision-banner-canvas]";
const GPU_READY_CLASS = "sol__vision_banner_gpu_ready";
const HYDRATING_CLASS = "sol__vision_banner_hydrating";
const VISUAL_READY_CLASS = "sol__vision_banner_visual_ready";
const RENDERER_ATTRIBUTE = "data-sol-vision-renderer";
const active_banners = new WeakMap();
const banner_disposals = new WeakMap();
const hydrating_banners = new WeakSet();

const matching_banners = (node) => {
  if (!node) return [];
  const matches = [];
  if (node.nodeType === 1 && node.matches?.(BANNER_SELECTOR))
    matches.push(node);
  matches.push(...Array.from(node.querySelectorAll?.(BANNER_SELECTOR) ?? []));
  return matches;
};

const hydrate_banner = (banner, backend = "auto") => {
  if (
    active_banners.has(banner) ||
    hydrating_banners.has(banner) ||
    banner.isConnected !== true
  )
    return;

  const canvas = banner.querySelector(CANVAS_SELECTOR);
  if (!canvas || canvas.nodeName !== "CANVAS") return;

  const state = {
    banner,
    breakout_observer: null,
    disposed: false,
    effect: null,
    image: null,
    image_height: 0,
    image_source: "",
    image_width: 0,
    initialized: false,
    initializing: false,
    runtime: null,
    visual_ready: false,
  };
  const listener_cleanups = [];
  const is_alive = () => !state.disposed && banner.isConnected === true;

  const restore_native_surface = () => {
    banner.classList.remove(
      HYDRATING_CLASS,
      GPU_READY_CLASS,
      VISUAL_READY_CLASS,
    );
    banner.removeAttribute(RENDERER_ATTRIBUTE);
  };

  const dispose = () => {
    if (state.disposed) return;
    state.disposed = true;
    for (const cleanup_listener of listener_cleanups.splice(0)) {
      try {
        cleanup_listener();
      } catch {
        // Continue releasing the remaining banner-owned lifecycle.
      }
    }
    state.breakout_observer?.disconnect();
    state.breakout_observer = null;
    state.runtime?.dispose?.();
    state.runtime = null;
    state.effect = null;
    active_banners.delete(banner);
    hydrating_banners.delete(banner);
    banner_disposals.delete(banner);
    restore_native_surface();
  };
  let failure_reported = false;
  const report_failure = (error_value) => {
    if (failure_reported) return;
    failure_reported = true;
    console.warn("[scripts-of-folly] vision banner disabled", error_value);
    dispose();
  };
  banner_disposals.set(banner, dispose);

  banner.classList.remove(GPU_READY_CLASS, VISUAL_READY_CLASS);
  banner.removeAttribute(RENDERER_ATTRIBUTE);
  hydrating_banners.add(banner);
  banner.classList.add(HYDRATING_CLASS);

  try {
    const {
      image,
      dom_image,
      source_nodes,
      get_loaded_image,
      get_image_source,
    } = create_banner_images(banner);

    const initialize = async () => {
      if (
        state.disposed ||
        state.initializing ||
        state.initialized ||
        !state.image
      )
        return;
      if (!is_alive()) {
        dispose();
        return;
      }

      state.initializing = true;
      try {
        const runtime = await create_gpu_effect_runtime({
          owner: banner,
          canvas,
          image: state.image,
          image_width: state.image_width,
          image_height: state.image_height,
          inverted_bowl: banner.dataset.visionVariant === "inverted-bowl",
          backend,
          dpr_cap: 2,
          is_owner_alive: is_alive,
          on_renderer_reset: restore_native_surface,
          on_first_frame: (renderer_backend) => {
            if (!is_alive()) return;
            state.visual_ready = true;
            banner.setAttribute(RENDERER_ATTRIBUTE, renderer_backend);
            banner.classList.add(GPU_READY_CLASS, VISUAL_READY_CLASS);
            banner.classList.remove(HYDRATING_CLASS);
          },
          on_error: dispose,
          maximum_frame_rate:
            globalThis.document?.documentElement?.dataset?.siteFps ?? 60,
        });
        if (!runtime || !is_alive()) {
          runtime?.dispose?.();
          return;
        }

        state.runtime = runtime;
        state.effect = runtime;
        state.initialized = true;
        active_banners.set(banner, state);
        hydrating_banners.delete(banner);
      } catch (error_value) {
        report_failure(error_value);
      } finally {
        state.initializing = false;
      }
    };

    const refresh_texture = (event_target = null) => {
      if (state.disposed) return;
      if (!is_alive()) {
        dispose();
        return;
      }
      const loaded_image = get_loaded_image(event_target);
      if (!loaded_image) return;
      const next_source = get_image_source(loaded_image);
      if (!update_banner_image(state, loaded_image, next_source)) return;
      if (!state.initialized && !state.initializing) void initialize();
    };

    const handle_image_error = (target) => {
      if (state.disposed) return;
      if (!is_alive()) {
        dispose();
        return;
      }
      if (
        !state.initialized &&
        !get_loaded_image(target) &&
        (target === dom_image || (!dom_image && target === image))
      )
        dispose();
    };

    const image_targets = [
      ...new Set([image, dom_image, ...source_nodes].filter(Boolean)),
    ];
    for (const image_target of image_targets) {
      listen_for_image(
        image_target,
        "load",
        () => refresh_texture(image_target),
        listener_cleanups,
      );
      listen_for_image(
        image_target,
        "error",
        () => handle_image_error(image_target),
        listener_cleanups,
      );
    }

    observe_banner_viewport(
      banner,
      state,
      listener_cleanups,
      is_alive,
      dispose,
      refresh_texture,
      dom_image,
    );

    if (image.complete) {
      image.naturalWidth > 0
        ? refresh_texture(image)
        : handle_image_error(image);
    }
  } catch (error_value) {
    report_failure(error_value);
  }
};

export const hydrate_vision_banners = (root = document, backend = "auto") => {
  for (const banner of matching_banners(root)) hydrate_banner(banner, backend);
};

export const install_vision_banners = ({
  root = document,
  backend = "auto",
} = {}) => {
  const controller = {
    disposed: false,
    refresh: () => {
      if (!controller.disposed) hydrate_vision_banners(root, backend);
    },
    dispose: () => {},
  };
  const cleanups = [];
  const observer = new MutationObserver((records) => {
    if (controller.disposed) return;
    for (const record of records) {
      for (const node of record.removedNodes) {
        for (const banner of matching_banners(node))
          banner_disposals.get(banner)?.();
      }
      for (const node of record.addedNodes) {
        for (const banner of matching_banners(node))
          hydrate_banner(banner, backend);
      }
    }
  });
  observer.observe(root, { childList: true, subtree: true });
  cleanups.push(() => observer.disconnect());

  const handle_hydration = () => controller.refresh();
  const handle_swap = (event) =>
    hydrate_vision_banners(event?.detail?.target ?? root, backend);
  if (root.readyState === "loading")
    root.addEventListener("DOMContentLoaded", handle_hydration, { once: true });
  else handle_hydration();
  root.addEventListener("htmx:afterSwap", handle_swap);
  cleanups.push(() => {
    root.removeEventListener("DOMContentLoaded", handle_hydration);
    root.removeEventListener("htmx:afterSwap", handle_swap);
  });

  controller.dispose = () => {
    if (controller.disposed) return;
    controller.disposed = true;
    for (const cleanup of cleanups.splice(0)) cleanup();
    for (const banner of matching_banners(root))
      banner_disposals.get(banner)?.();
  };
  return controller;
};
