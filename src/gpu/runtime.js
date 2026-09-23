import { capture_text } from "./text_capture.js";
import { read_effect_parameters } from "./parameters.js";
import { create_renderer, dispose_renderer } from "./renderer.js";
import {
  collect_effect_names,
  TEXT_EFFECTS,
  PANEL_EFFECTS,
} from "./registry.js";
import "./gpu.css";

const TEXT_READY_ATTRIBUTE = "data-folly-gpu-text";
const PANEL_READY_ATTRIBUTE = "data-folly-gpu-panel";
const CAPTURE_ATTRIBUTE = "data-folly-capture";
const SOFT_EFFECTS = new Set([
  "glow",
  "neon",
  "shadow",
  "blur",
  "aura",
  "etch",
  "whisper",
  "sigil_pulse",
  "veil",
  "cadence_oracular",
]);
const DYNAMIC_ATTRIBUTES = new Set([
  "class",
  "style",
  "data-text-fx",
  "data-text-fx-intensity",
  "data-text-fx-motion",
  "data-text-fx-speed",
  "data-text-fx-color",
  "data-block-fx-intensity",
  "data-block-fx-motion",
  "data-block-fx-speed",
  "data-site-fps",
  "data-site-motion",
  "data-site-reduced-motion",
]);

function is_element(value) {
  return value?.nodeType === 1;
}

function is_internal_node(value) {
  return (
    is_element(value) &&
    (value.matches?.(".folly-gpu-canvas") ||
      value.hasAttribute(CAPTURE_ATTRIBUTE) ||
      value.hasAttribute("data-folly-probe"))
  );
}

function element_is_in_root(element, root) {
  return root.nodeType === 9
    ? root.documentElement.contains(element)
    : root.contains(element);
}

function element_names(element) {
  return collect_effect_names(element).filter(
    (name) => TEXT_EFFECTS.includes(name) || PANEL_EFFECTS.includes(name),
  );
}

function is_panel_target(names) {
  return names.some((name) => PANEL_EFFECTS.includes(name));
}

function finite_rect(rect) {
  return (
    rect &&
    [rect.left, rect.top, rect.width, rect.height].every(Number.isFinite)
  );
}

function border_radius_is_round(style) {
  return [
    style.borderTopLeftRadius,
    style.borderTopRightRadius,
    style.borderBottomRightRadius,
    style.borderBottomLeftRadius,
  ].some((value) => Number.parseFloat(value) > 0);
}

function clipping_overflow(style) {
  return [style.overflow, style.overflowX, style.overflowY].some(
    (value) =>
      value === "hidden" ||
      value === "clip" ||
      value === "scroll" ||
      value === "auto",
  );
}

function target_is_transitioning(element) {
  return element.closest?.(".sol__pretext_transitioning") != null;
}

function effective_effect_names(element) {
  const lineage = [];
  let current = element;
  while (current && current.nodeType === 1) {
    lineage.unshift(current);
    current = current.parentElement;
  }
  const names = [];
  for (const owner of lineage) {
    for (const name of element_names(owner)) {
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

function has_nested_effect_owner(element, query_root) {
  let ancestor = element.parentElement;
  while (ancestor && ancestor !== query_root) {
    if (element_names(ancestor).length) return true;
    ancestor = ancestor.parentElement;
  }
  for (const descendant of element.querySelectorAll?.("*") || []) {
    if (element_names(descendant).length) return true;
  }
  return false;
}

function capture_representable(element) {
  return (
    !element.matches?.(
      "button,input,select,textarea,audio,video,canvas,svg,iframe,object,embed",
    ) &&
    !element.querySelector?.(
      "button,input,select,textarea,audio,video,canvas,svg,iframe,object,embed",
    )
  );
}

function target_is_representable(element) {
  const names = effective_effect_names(element);
  return is_panel_target(names) || capture_representable(element);
}
function make_panel_capture(element) {
  const document_value = element.ownerDocument;
  const rect = element.getBoundingClientRect();
  const style = document_value.defaultView.getComputedStyle(element);
  const canvas = document_value.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  canvas.getContext("2d")?.clearRect(0, 0, 1, 1);
  return {
    canvas,
    width: Math.max(1, rect.width),
    height: Math.max(1, rect.height),
    padding: 0,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    font_size: Number.parseFloat(style.fontSize) || 16,
    base_color: "rgb(0, 0, 0)",
  };
}

export function install_gpu_effects({
  root = document,
  backend = "auto",
} = {}) {
  const document_value = root.nodeType === 9 ? root : root.ownerDocument;
  const view = document_value.defaultView || globalThis;
  const query_root =
    root.nodeType === 9 ? document_value.documentElement : root;
  const items = new Map();
  const cleanup = [];
  const dirty_targets = new Set();
  const observed_sizes = new WeakMap();
  let queued_again = false;
  let resize_observer = null;
  let media_query = null;
  let media_query_listener = null;
  let renderer_state = null;
  let canvas = null;
  let refresh_promise = null;
  let boot_promise = null;
  let draw_promise = null;
  let warned_failure_epoch = -1;
  let animation_frame = 0;
  let frame_timer = 0;
  let epoch = 0;
  let animation_time = 0;
  let previous_frame_time = null;
  let empty_frame_cleared = false;
  let render_dirty = true;
  let dead = false;
  let failed = false;
  let fallback_attempted = backend === "webgl2";
  let recovering = false;

  function current_reduced_motion() {
    return (
      view.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true
    );
  }

  function report_failure(error) {
    if (warned_failure_epoch === epoch) return;
    warned_failure_epoch = epoch;
    console.warn(
      "[Scripts of Folly] GPU effects unavailable; keeping native CSS.",
      error,
    );
  }

  function current_fps() {
    const sources = [
      document_value.documentElement,
      document_value.body,
      is_element(root) ? root : null,
    ];
    for (const source of sources) {
      const value = source?.getAttribute("data-site-fps");
      if (!value) continue;
      if (/display|refresh/i.test(value)) return 0;
      const parsed = Number(value);
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return 60;
  }

  function is_alive(token = epoch) {
    return !dead && token === epoch;
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

  function restore_target(target) {
    target.removeAttribute(TEXT_READY_ATTRIBUTE);
    target.removeAttribute(PANEL_READY_ATTRIBUTE);
  }

  function restore_all_targets() {
    for (const target of items.keys()) restore_target(target);
  }

  function dispose_item(target) {
    const item = items.get(target);
    if (!item) return;

    items.delete(target);
    dirty_targets.delete(target);
    resize_observer?.unobserve?.(target);
    restore_target(target);
    try {
      item.handle?.dispose?.();
    } catch (error) {
      return error;
    }
  }

  function dispose_items() {
    for (const target of [...items.keys()]) dispose_item(target);
  }

  function find_effect_target(node) {
    let current = is_element(node) ? node : node?.parentElement;
    while (current && current !== query_root) {
      if (element_names(current).length > 0) return current;
      current = current.parentElement;
    }
    return is_element(query_root) && element_names(query_root).length > 0
      ? query_root
      : null;
  }

  function mark_dirty(target) {
    const owner = find_effect_target(target) || target;
    if (is_element(owner)) dirty_targets.add(owner);
    render_dirty = true;
  }

  function mark_all_dirty() {
    for (const target of items.keys()) dirty_targets.add(target);
    render_dirty = true;
  }

  function stop_drawing() {
    if (animation_frame) view.cancelAnimationFrame(animation_frame);
    if (frame_timer) view.clearTimeout(frame_timer);
    animation_frame = 0;
    frame_timer = 0;
    previous_frame_time = null;
  }

  function schedule_draw() {
    if (
      dead ||
      !renderer_state ||
      animation_frame ||
      frame_timer ||
      draw_promise
    )
      return;
    if (!render_dirty && current_reduced_motion()) return;

    const request = () => {
      frame_timer = 0;
      if (!dead) animation_frame = view.requestAnimationFrame(draw_frame);
    };
    const fps = current_fps();
    if (fps > 0 && previous_frame_time != null) {
      const delay = Math.max(
        0,
        1000 / fps - (view.performance?.now?.() - previous_frame_time),
      );
      if (delay > 1) {
        frame_timer = view.setTimeout(request, delay);
        return;
      }
    }
    animation_frame = view.requestAnimationFrame(draw_frame);
  }

  function viewport_size() {
    return {
      width: Math.max(
        1,
        view.innerWidth || document_value.documentElement.clientWidth || 1,
      ),
      height: Math.max(
        1,
        view.innerHeight || document_value.documentElement.clientHeight || 1,
      ),
    };
  }

  function update_surface_size() {
    if (!renderer_state) return;
    const viewport = viewport_size();
    const dpr = Math.min(1.5, Math.max(1, view.devicePixelRatio || 1));
    if (canvas) {
      // The GPU frame uses the full viewport, including any stable scrollbar gutter.
      const width = `${viewport.width}px`;
      const height = `${viewport.height}px`;
      if (canvas.style.width !== width) canvas.style.width = width;
      if (canvas.style.height !== height) canvas.style.height = height;
    }
    renderer_state.resize(viewport.width, viewport.height, dpr);
  }

  function rounded_corner_overlaps(rect, ancestor_rect, style) {
    if (!border_radius_is_round(style)) return false;
    const radius = Math.max(
      Number.parseFloat(style.borderTopLeftRadius) || 0,
      Number.parseFloat(style.borderTopRightRadius) || 0,
      Number.parseFloat(style.borderBottomRightRadius) || 0,
      Number.parseFloat(style.borderBottomLeftRadius) || 0,
    );
    return (
      (rect.left < ancestor_rect.left + radius &&
        rect.top < ancestor_rect.top + radius) ||
      (rect.right > ancestor_rect.right - radius &&
        rect.top < ancestor_rect.top + radius) ||
      (rect.left < ancestor_rect.left + radius &&
        rect.bottom > ancestor_rect.bottom - radius) ||
      (rect.right > ancestor_rect.right - radius &&
        rect.bottom > ancestor_rect.bottom - radius)
    );
  }

  function visible_clip(item) {
    if (document_value.visibilityState === "hidden") return null;

    const target = item.target;
    const style = view.getComputedStyle(target);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity) === 0
    )
      return null;

    const target_rect = target.getBoundingClientRect();
    const rect = {
      left: target_rect.left + (target_rect.width - item.width) / 2,
      top: target_rect.top + (target_rect.height - item.height) / 2,
      right:
        target_rect.left + (target_rect.width - item.width) / 2 + item.width,
      bottom:
        target_rect.top + (target_rect.height - item.height) / 2 + item.height,
      width: item.width,
      height: item.height,
    };
    if (!finite_rect(rect) || rect.width <= 0 || rect.height <= 0) return null;

    const viewport = viewport_size();
    const clip = {
      left: Math.max(0, rect.left),
      top: Math.max(0, rect.top),
      right: Math.min(viewport.width, rect.right),
      bottom: Math.min(viewport.height, rect.bottom),
    };
    let ancestor = target.parentElement;
    while (ancestor && ancestor !== document_value.documentElement) {
      const ancestor_style = view.getComputedStyle(ancestor);
      if (
        ancestor_style.display === "none" ||
        ancestor_style.visibility === "hidden" ||
        Number(ancestor_style.opacity) === 0
      )
        return null;
      if (clipping_overflow(ancestor_style)) {
        const ancestor_rect = ancestor.getBoundingClientRect();
        if (rounded_corner_overlaps(rect, ancestor_rect, ancestor_style))
          return null;
        clip.left = Math.max(clip.left, ancestor_rect.left);
        clip.top = Math.max(clip.top, ancestor_rect.top);
        clip.right = Math.min(clip.right, ancestor_rect.right);
        clip.bottom = Math.min(clip.bottom, ancestor_rect.bottom);
      }
      ancestor = ancestor.parentElement;
    }
    if (clip.right <= clip.left || clip.bottom <= clip.top) return null;

    const center_x = (clip.left + clip.right) / 2;
    const center_y = (clip.top + clip.bottom) / 2;
    const hit = document_value.elementFromPoint?.(center_x, center_y);
    if (hit && hit !== target && !target.contains(hit)) return null;

    return clip;
  }

  function item_entry(item) {
    const target_rect = item.target.getBoundingClientRect();
    const clip = visible_clip(item);
    if (!clip) {
      restore_target(item.target);
      return null;
    }
    return {
      item,
      handle: item.handle,
      rect: {
        left: target_rect.left + (target_rect.width - item.width) / 2,
        top: target_rect.top + (target_rect.height - item.height) / 2,
        width: item.width,
        height: item.height,
      },
      clip,
    };
  }

  async function draw_frame(frame_time) {
    animation_frame = 0;
    if (
      dead ||
      !renderer_state ||
      document_value.visibilityState === "hidden"
    ) {
      stop_drawing();
      return;
    }
    if (draw_promise) return;

    let keep_animating = false;
    let retry_after_draw = false;
    draw_promise = (async () => {
      const entries = [];
      for (const item of items.values()) {
        const entry = item_entry(item);
        if (entry) entries.push(entry);
      }

      if (!entries.length) {
        if (!empty_frame_cleared) {
          await renderer_state.render([], 0);
          empty_frame_cleared = true;
        }
        render_dirty = false;
        stop_drawing();
        return;
      }
      empty_frame_cleared = false;
      if (current_reduced_motion()) {
        animation_time = 0;
      } else if (previous_frame_time != null) {
        animation_time += Math.max(0, frame_time - previous_frame_time) / 1000;
      }
      previous_frame_time = frame_time;

      try {
        await renderer_state.render(
          entries.map(({ handle, rect, clip }) => ({ handle, rect, clip })),
          animation_time,
        );
        for (const { item } of entries) {
          item.target.setAttribute(
            item.kind === "panel"
              ? PANEL_READY_ATTRIBUTE
              : TEXT_READY_ATTRIBUTE,
            "ready",
          );
        }
        render_dirty = false;
        keep_animating = !current_reduced_motion();
      } catch (error) {
        await recover_from_loss(error);
        retry_after_draw = true;
      }
    })();
    try {
      await draw_promise;
    } finally {
      draw_promise = null;
      if (
        ((keep_animating && render_dirty === false) || retry_after_draw) &&
        !dead &&
        renderer_state
      )
        schedule_draw();
    }
  }

  async function recover_from_loss(loss_error) {
    if (dead || recovering) return;

    recovering = true;
    const lost_backend = renderer_state?.backend;
    epoch += 1;
    const recovery_epoch = epoch;
    stop_drawing();
    restore_all_targets();
    dispose_items();
    dispose_renderer(renderer_state);
    renderer_state = null;
    canvas?.remove();
    canvas = null;

    try {
      if (lost_backend === "webgl2" || fallback_attempted) {
        failed = true;
        report_failure(
          loss_error || new Error("GPU backend lost after fallback"),
        );
        render_dirty = false;
        return;
      }
      fallback_attempted = true;
      await boot_renderer("webgl2");
      if (renderer_state) {
        failed = false;
        mark_all_dirty();
        await refresh_targets();
      }
    } catch (error) {
      if (dead || recovery_epoch !== epoch) return;

      failed = true;
      report_failure(
        loss_error
          ? new AggregateError([loss_error, error], "GPU fallback failed")
          : error,
      );
      restore_all_targets();
      renderer_state = null;
    } finally {
      recovering = false;
      if (!renderer_state) render_dirty = false;
    }
  }

  async function boot_renderer(requested_backend = backend) {
    if (renderer_state || dead || failed) return renderer_state;
    if (boot_promise) return boot_promise;

    const token = epoch;
    boot_promise = (async () => {
      canvas = make_canvas();
      const created = await create_renderer(canvas, {
        backend: requested_backend,
        is_alive: () => is_alive(token),
        on_lost: (loss_error) => recover_from_loss(loss_error),
      });

      if (!created || !is_alive(token)) {
        created?.dispose?.();
        canvas?.remove();
        canvas = null;
        return null;
      }

      renderer_state = created;
      canvas = created.canvas || canvas;
      canvas.dataset.follyRenderer = created.backend;
      update_surface_size();

      return renderer_state;
    })();
    try {
      const result = await boot_promise;
      if (result?.backend === "webgl2") fallback_attempted = true;
      return result;
    } catch (error) {
      if (dead || token !== epoch) return null;

      failed = true;
      report_failure(error);
      restore_all_targets();
      canvas?.remove();
      canvas = null;
      throw error;
    } finally {
      boot_promise = null;
    }
  }

  async function prepare_target(target, names, token) {
    const panel = is_panel_target(names);
    dispose_item(target);
    restore_target(target);

    let captured = panel ? make_panel_capture(target) : null;
    const soft = !panel && names.some((name) => SOFT_EFFECTS.has(name));
    if (!panel) {
      target.setAttribute(CAPTURE_ATTRIBUTE, "");
      try {
        captured = capture_text(target, {
          dpr: Math.min(1.5, Math.max(1, view.devicePixelRatio || 1)),
          padding: soft ? 64 : 8,
          soft,
        });
      } finally {
        target.removeAttribute(CAPTURE_ATTRIBUTE);
      }
    }

    if (!panel && !captured) {
      restore_target(target);
      dirty_targets.delete(target);
      return;
    }
    if (
      !is_alive(token) ||
      !renderer_state ||
      !element_is_in_root(target, root)
    )
      return;

    const parameter_sets = names.map((name) =>
      read_effect_parameters(target, name, captured),
    );

    let handle;
    try {
      handle = await renderer_state.prepare(
        captured,
        names,
        parameter_sets,
        panel ? "panel" : "text",
      );
    } catch (error) {
      if (dead || !is_alive(token)) return null;
      const backend_error =
        error instanceof Error
          ? error
          : new Error(String(error), { cause: error });
      backend_error.folly_backend_failure = true;
      throw backend_error;
    }

    if (!handle || !is_alive(token) || !renderer_state) {
      handle?.dispose?.();
      return;
    }

    const rect = target.getBoundingClientRect();
    const item = {
      target,
      names,
      kind: panel ? "panel" : "text",
      handle,
      width: captured?.width ?? rect.width,
      height: captured?.height ?? rect.height,
    };
    items.set(target, item);
    resize_observer?.observe(target);
    dirty_targets.delete(target);
    render_dirty = true;
  }

  function find_targets() {
    const targets = [];

    if (
      is_element(query_root) &&
      effective_effect_names(query_root).length &&
      target_is_representable(query_root) &&
      !target_is_transitioning(query_root) &&
      !has_nested_effect_owner(query_root, query_root)
    )
      targets.push(query_root);

    for (const element of query_root.querySelectorAll?.("*") || []) {
      if (
        !is_internal_node(element) &&
        effective_effect_names(element).length &&
        target_is_representable(element) &&
        !target_is_transitioning(element) &&
        !has_nested_effect_owner(element, query_root)
      )
        targets.push(element);
    }

    return targets;
  }

  async function refresh_targets() {
    if (dead || failed) return;

    const token = epoch;
    await boot_renderer();

    if (!renderer_state || !is_alive(token)) return;
    const targets = find_targets();
    const target_set = new Set(targets);
    for (const target of [...items.keys()]) {
      if (!target_set.has(target) || !element_is_in_root(target, root))
        dispose_item(target);
    }

    for (const target of targets) {
      const names = effective_effect_names(target);
      const existing = items.get(target);
      const changed =
        !existing || existing.names.join("\u0000") !== names.join("\u0000");
      if (changed || dirty_targets.has(target))
        await prepare_target(target, names, token);
    }

    update_surface_size();
    render_dirty = true;
    schedule_draw();
  }

  function schedule_refresh() {
    if (dead) return;
    if (refresh_promise) {
      queued_again = true;
      return;
    }

    const refresh_epoch = epoch;
    refresh_promise = Promise.resolve().then(async () => {
      try {
        await refresh_targets();
      } catch (error) {
        if (dead || refresh_epoch !== epoch) return;
        const can_fallback =
          error?.folly_backend_failure &&
          renderer_state?.backend === "webgpu" &&
          !fallback_attempted;
        if (can_fallback) {
          await recover_from_loss(error);
        } else {
          failed = true;
          report_failure(error);
          restore_all_targets();
          dispose_renderer(renderer_state);
          renderer_state = null;
          canvas?.remove();
          canvas = null;
        }
      } finally {
        refresh_promise = null;
        if (queued_again && !dead) {
          queued_again = false;
          schedule_refresh();
        }
      }
    });
  }

  function handle_mutations(records) {
    let changed = false;
    for (const record of records) {
      if (record.type === "attributes") {
        if (record.target === canvas || is_internal_node(record.target))
          continue;
        const attribute_name = record.attributeName || "";
        if (
          attribute_name === "data-text-fx-hydrated" ||
          attribute_name === "data-combat-tokens-hydrated" ||
          record.oldValue === record.target.getAttribute(attribute_name)
        )
          continue;
        if (
          DYNAMIC_ATTRIBUTES.has(attribute_name) ||
          attribute_name.startsWith("data-text-fx-") ||
          attribute_name.startsWith("data-block-fx-") ||
          attribute_name.startsWith("data-site-")
        ) {
          const effect_target = find_effect_target(record.target);
          if (effect_target) mark_dirty(effect_target);
          else mark_all_dirty();
          changed = true;
        }
      } else if (record.type === "characterData") {
        const effect_target = find_effect_target(record.target);
        if (effect_target) mark_dirty(effect_target);
        else mark_all_dirty();
        changed = true;
      } else if (record.type === "childList") {
        const nodes = [...record.addedNodes, ...record.removedNodes];
        if (
          is_internal_node(record.target) ||
          (nodes.length > 0 && nodes.every(is_internal_node))
        )
          continue;
        mark_all_dirty();
        changed = true;
      }
    }

    if (changed) schedule_refresh();
  }

  function add_listener(target, name, callback, options) {
    target?.addEventListener?.(name, callback, options);
    cleanup.push(() => target?.removeEventListener?.(name, callback, options));
  }

  function attach_observers() {
    const observer = new MutationObserver(handle_mutations);
    observer.observe(root, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeOldValue: true,
    });
    cleanup.push(() => observer.disconnect());

    resize_observer =
      typeof ResizeObserver === "function"
        ? new ResizeObserver((entries) => {
            let changed = false;
            for (const entry of entries) {
              const width = Number(entry.contentRect?.width) || 0;
              const height = Number(entry.contentRect?.height) || 0;
              const previous = observed_sizes.get(entry.target);
              observed_sizes.set(entry.target, { width, height });
              if (
                !previous ||
                (previous.width === width && previous.height === height)
              )
                continue;
              mark_dirty(entry.target);
              changed = true;
            }
            if (changed) schedule_refresh();
          })
        : null;
    if (resize_observer) cleanup.push(() => resize_observer.disconnect());
    for (const target of find_targets()) resize_observer?.observe(target);

    add_listener(
      view,
      "resize",
      () => {
        mark_all_dirty();
        update_surface_size();
        schedule_refresh();
      },
      { passive: true },
    );

    add_listener(
      view,
      "scroll",
      () => {
        render_dirty = true;
        schedule_draw();
      },
      { passive: true, capture: true },
    );

    add_listener(document_value, "visibilitychange", () => {
      if (document_value.visibilityState === "hidden") {
        restore_all_targets();
        stop_drawing();
      } else {
        previous_frame_time = null;
        render_dirty = true;
        schedule_refresh();
      }
    });

    add_listener(document_value, "htmx:afterSwap", () => {
      mark_all_dirty();
      schedule_refresh();
    });

    add_listener(document_value, "htmx:historyRestore", () => {
      mark_all_dirty();
      schedule_refresh();
    });

    add_listener(document_value, "folly:pretext-before-layout", (event) => {
      const fragment = event.detail?.element || event.target;
      for (const target of [...items.keys()]) {
        if (target === fragment || fragment?.contains?.(target))
          dispose_item(target);
      }
    });

    add_listener(document_value, "folly:pretext-layout", () => {
      mark_all_dirty();
      schedule_refresh();
    });

    add_listener(document_value.fonts, "loadingdone", () => {
      mark_all_dirty();
      schedule_refresh();
    });

    add_listener(document_value.fonts, "loadingerror", () => {
      mark_all_dirty();
      schedule_refresh();
    });

    media_query = view.matchMedia?.("(prefers-reduced-motion: reduce)");
    media_query_listener = () => {
      previous_frame_time = null;
      render_dirty = true;
      restore_all_targets();
      schedule_draw();
    };
    media_query?.addEventListener?.("change", media_query_listener);
    cleanup.push(() =>
      media_query?.removeEventListener?.("change", media_query_listener),
    );
  }

  async function refresh() {
    if (dead) return;

    failed = false;
    fallback_attempted = backend === "webgl2";
    warned_failure_epoch = -1;
    mark_all_dirty();
    schedule_refresh();

    while (!dead && refresh_promise) {
      const pending_refresh = refresh_promise;
      await pending_refresh;
    }
  }

  function dispose() {
    if (dead) return;

    dead = true;
    epoch += 1;
    queued_again = false;
    dirty_targets.clear();
    stop_drawing();
    for (const remove_listener of cleanup.splice(0)) remove_listener();
    restore_all_targets();
    dispose_items();
    dispose_renderer(renderer_state);
    renderer_state = null;
    canvas?.remove();
    canvas = null;
  }

  attach_observers();

  schedule_refresh();

  return { refresh, dispose };
}
