// The GPU text runtime of one page. This module keeps the list of effect
// items. It decides when an item needs a new capture and prepares it.
//
//   ./targets.js       which elements are targets
//   ./visibility.js    which targets are on screen
//   ./presentation.js  the presenter canvas of an item
//   ./frame_loop.js    when a frame draws, and the frame itself
//   ./lifecycle.js     the renderer: boot, loss, fallback, failure
import { WIDE_CAPTURE_PADDING } from "./blur_levels.js";
import { capture_text } from "./text_capture.js";
import { read_effect_parameters } from "./parameters.js";
import { create_frame_budget } from "./budget.js";
import { create_frame_loop } from "./frame_loop.js";
import { create_renderer_lifecycle } from "./lifecycle.js";
import {
  CAPTURE_ATTRIBUTE,
  PANEL_READY_ATTRIBUTE,
  TEXT_READY_ATTRIBUTE,
} from "./markers.js";
import {
  create_presentation,
  dispose_presentation,
  effect_dpr,
  hide_presentation,
  presentation_is_attached,
} from "./presentation.js";
import {
  effect_owner,
  effective_effect_names,
  element_is_in_root,
  find_effect_target,
  find_targets,
  is_element,
  is_internal_node,
  is_panel_target,
} from "./targets.js";
import { scene_for } from "../scene/index.js";
import "./gpu.css";

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
  "drown",
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

// `open_gpu(kind, request)` lets a host page open the gpu through its own
// seam. It returns { kind, api, gpu } like open_gpu in ./renderer.js, the
// default. `request.timing` asks for GPU timing; webgpu_init_options turns it
// into vgpu init options.
// `ignore_mutation(record)` lets an editor exclude nonvisual UI mutations.
export { webgpu_init_options } from "./open_gpu.js";
export function install_gpu_effects({
  root = document,
  backend = "auto",
  open_gpu = undefined,
  ignore_mutation = undefined,
} = {}) {
  const document_value = root.nodeType === 9 ? root : root.ownerDocument;
  const view = document_value.defaultView || globalThis;
  const scene = scene_for(document_value);
  const query_root =
    root.nodeType === 9 ? document_value.documentElement : root;
  const items = new Map();
  const cleanup = [];
  const dirty_targets = new Set();
  const observed_sizes = new WeakMap();
  let resize_observer = null;
  // The refresh is idle, running, or running with one more run queued.
  // `schedule_refresh()` owns both values.
  let refresh_promise = null;
  let queued_again = false;
  const budget = create_frame_budget({ now: () => view.performance.now() });
  const lifecycle = create_renderer_lifecycle({
    document_value,
    backend,
    open_gpu,
    on_gpu_time(handle, ms) {
      for (const item of items.values()) {
        if (item.handle === handle) {
          budget.gpu_time(item, ms);
          return;
        }
      }
    },
    on_release() {
      frame.stop();
      restore_all_targets();
      dispose_items();
    },
    async on_restart() {
      mark_all_dirty();
      await refresh_targets();
    },
    on_restore: () => restore_all_targets(),
  });
  const frame = create_frame_loop({
    view,
    document_value,
    root,
    items,
    budget,
    lifecycle,
    restore_target,
  });

  function restore_target(target) {
    target.removeAttribute(TEXT_READY_ATTRIBUTE);
    target.removeAttribute(PANEL_READY_ATTRIBUTE);
    hide_presentation(items.get(target));
  }
  function restore_all_targets() {
    for (const target of items.keys()) restore_target(target);
  }

  function dispose_item(target) {
    const item = items.get(target);
    if (!item) return;

    items.delete(target);
    dirty_targets.delete(target);
    mark_owners_above(target);
    resize_observer?.unobserve?.(target);
    restore_target(target);
    dispose_presentation(item);
    try {
      item.handle?.dispose?.();
    } catch (error) {
      return error;
    }
  }

  // A ready owner hides all of its descendants. It captures every run that a
  // nested text item does not present, so a failed child stays readable.
  function owns_text(target, node) {
    let current = is_element(node) ? node : node.parentElement;
    while (current && current !== target) {
      if (items.get(current)?.kind === "text") return false;
      current = current.parentElement;
    }
    return true;
  }

  function mark_owners_above(target) {
    for (const owner of items.keys()) {
      if (owner !== target && owner.contains(target)) dirty_targets.add(owner);
    }
  }

  function dispose_items() {
    for (const target of [...items.keys()]) dispose_item(target);
  }

  function mark_dirty(target) {
    const owner = find_effect_target(target, query_root) || target;
    if (is_element(owner)) {
      dirty_targets.add(owner);
      // Nested owners share inherited effects and one inline flow.
      for (const item_target of items.keys()) {
        if (item_target.contains(owner) || owner.contains(item_target))
          dirty_targets.add(item_target);
      }
    }
    frame.invalidate();
  }

  function mark_all_dirty() {
    for (const target of items.keys()) dirty_targets.add(target);
    frame.invalidate();
  }

  function mark_affected(node) {
    const scope = scene.owner(node)?.element;
    if (!scope) {
      mark_all_dirty();
      return;
    }
    for (const target of items.keys()) {
      if (scope.contains(target) || target.contains(scope)) mark_dirty(target);
    }
  }

  // Prepares `target` again. The capture reads the DOM when this call starts.
  // A mark that comes during the GPU work is newer than the capture, so it
  // stays for the next refresh. A target that got no new item stays marked.
  async function prepare_target(target, names, token) {
    const was_dirty = dirty_targets.delete(target);
    let prepared = false;
    try {
      prepared = await capture_target(target, names, token);
    } finally {
      if (!prepared && was_dirty) dirty_targets.add(target);
    }
  }

  // True when `target` has its final state for this capture: a new item, or
  // no item because it has no ink.
  async function capture_target(target, names, token) {
    const panel = is_panel_target(names);
    const previous = items.get(target);
    if (!previous) restore_target(target);

    let captured = panel ? make_panel_capture(target) : null;
    const soft = !panel && names.some((name) => SOFT_EFFECTS.has(name));
    if (!panel) {
      target.setAttribute(CAPTURE_ATTRIBUTE, "");
      try {
        captured = capture_text(target, {
          dpr: effect_dpr(view),
          padding: soft || names.includes("rift") ? WIDE_CAPTURE_PADDING : 8,
          soft,
          owns: (node) => owns_text(target, node),
        });
      } finally {
        target.removeAttribute(CAPTURE_ATTRIBUTE);
      }
    }

    if (!panel && !captured) {
      dispose_item(target);
      restore_target(target);
      return true;
    }
    if (
      !lifecycle.is_alive(token) ||
      !lifecycle.renderer ||
      !element_is_in_root(target, root)
    )
      return false;

    const parameter_sets = names.map((name) =>
      read_effect_parameters(effect_owner(target, name), name, captured),
    );

    let handle;
    try {
      handle = await lifecycle.renderer.prepare(
        captured,
        names,
        parameter_sets,
        panel ? "panel" : "text",
      );
    } catch (error) {
      if (!lifecycle.is_alive(token)) return false;
      const backend_error =
        error instanceof Error
          ? error
          : new Error(String(error), { cause: error });
      backend_error.folly_backend_failure = true;
      throw backend_error;
    }

    if (!handle || !lifecycle.is_alive(token) || !lifecycle.renderer) {
      handle?.dispose?.();
      return false;
    }

    const rect = target.getBoundingClientRect();
    const item = {
      target,
      names,
      kind: panel ? "panel" : "text",
      handle,
      width: captured?.width ?? rect.width,
      height: captured?.height ?? rect.height,
      presentation: null,
    };
    // A DOM morph can keep a target and remove its presenter. That presenter
    // shows nothing, so the item gets a new one.
    if (previous?.kind === item.kind && presentation_is_attached(previous)) {
      await frame.drawing;
      if (!lifecycle.is_alive(token) || items.get(target) !== previous) {
        handle.dispose?.();
        return false;
      }
      item.presentation = previous.presentation;
      previous.presentation = null;
      previous.handle?.dispose?.();
    } else {
      // The old item goes, and the mark of a newer change stays.
      const marked = dirty_targets.has(target);
      dispose_item(target);
      if (marked) dirty_targets.add(target);
      item.presentation = create_presentation(target, item.width, item.height);
    }
    if (!item.presentation) {
      handle.dispose?.();
      return false;
    }
    items.set(target, item);
    if (!previous) mark_owners_above(target);
    resize_observer?.observe(target);
    frame.invalidate();
    return true;
  }

  async function refresh_targets() {
    if (lifecycle.dead || lifecycle.failed) return;

    const token = lifecycle.epoch;
    await lifecycle.boot();

    if (!lifecycle.renderer || !lifecycle.is_alive(token)) return;
    const targets = find_targets(query_root);
    const target_set = new Set(targets);
    for (const target of [...items.keys()]) {
      if (!target_set.has(target) || !element_is_in_root(target, root))
        dispose_item(target);
    }

    // Nested items settle before their owners capture the remaining ink.
    for (const target of [...targets].reverse()) {
      const names = effective_effect_names(target);
      const existing = items.get(target);
      const changed =
        !existing || existing.names.join("\u0000") !== names.join("\u0000");
      if (changed || dirty_targets.has(target))
        await prepare_target(target, names, token);
    }

    frame.invalidate();
    frame.schedule();
  }

  function schedule_refresh() {
    if (lifecycle.dead) return;
    if (refresh_promise) {
      queued_again = true;
      return;
    }

    const refresh_epoch = lifecycle.epoch;
    refresh_promise = Promise.resolve().then(async () => {
      try {
        await refresh_targets();
      } catch (error) {
        if (lifecycle.dead || refresh_epoch !== lifecycle.epoch) return;
        if (error?.folly_backend_failure && lifecycle.can_fall_back)
          await lifecycle.recover(error);
        else lifecycle.fail(error);
      } finally {
        refresh_promise = null;
        if (queued_again && !lifecycle.dead) {
          queued_again = false;
          schedule_refresh();
        } else if (!lifecycle.dead) {
          // Every dirty target is prepared (or restored after a failure). A
          // host page can show its text effects now.
          document_value.dispatchEvent(
            new view.CustomEvent("folly:gpu-settled"),
          );
          warm_when_idle();
        }
      }
    });
  }

  // Asks the renderer for a spare draw while the page is idle. The next new
  // capture then does not wait for the shader text.
  function warm_when_idle() {
    const warm = () => {
      if (lifecycle.dead) return;
      try {
        lifecycle.renderer?.warm?.();
      } catch (error) {
        // A spare is optional: the next capture makes its own draw, and a
        // broken renderer fails there with the full recovery.
        console.warn("[Scripts of Folly] No spare GPU draw.", error);
      }
    };
    if (typeof view.requestIdleCallback === "function")
      view.requestIdleCallback(warm, { timeout: 2000 });
    else view.setTimeout(warm, 200);
  }

  function handle_mutations(records) {
    let changed = false;
    for (const record of records) {
      if (ignore_mutation?.(record) || scene.ignores_mutation(record)) continue;
      if (record.type === "attributes") {
        if (
          record.target === lifecycle.canvas ||
          is_internal_node(record.target)
        )
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
          const effect_target = find_effect_target(record.target, query_root);
          if (effect_target) mark_dirty(effect_target);
          else mark_affected(record.target);
          changed = true;
        }
      } else if (record.type === "characterData") {
        const effect_target = find_effect_target(record.target, query_root);
        if (effect_target) {
          mark_dirty(effect_target);
          changed = true;
        }
      } else if (record.type === "childList") {
        const nodes = [...record.addedNodes, ...record.removedNodes];
        if (
          is_internal_node(record.target) ||
          (nodes.length > 0 && nodes.every(is_internal_node))
        )
          continue;
        const effect_target = find_effect_target(record.target, query_root);
        if (effect_target) mark_dirty(effect_target);
        for (const node of nodes) {
          for (const target of items.keys()) {
            if (node.contains(target)) mark_dirty(target);
          }
        }
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
    for (const target of find_targets(query_root))
      resize_observer?.observe(target);

    add_listener(
      view,
      "resize",
      () => {
        mark_all_dirty();
        schedule_refresh();
      },
      { passive: true },
    );

    add_listener(
      view,
      "scroll",
      () => {
        frame.invalidate();
        frame.schedule();
      },
      { passive: true, capture: true },
    );

    add_listener(document_value, "visibilitychange", () => {
      if (document_value.visibilityState === "hidden") {
        restore_all_targets();
        frame.stop();
      } else {
        frame.reset_clock();
        frame.invalidate();
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

    add_listener(document_value, "folly:pretext-layout", (event) => {
      mark_affected(event.detail?.element || event.target);
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

    add_listener(
      view.matchMedia?.("(prefers-reduced-motion: reduce)"),
      "change",
      () => {
        frame.reset_clock();
        frame.invalidate();
        restore_all_targets();
        frame.schedule();
      },
    );
  }

  async function refresh() {
    if (lifecycle.dead) return;

    lifecycle.rearm();
    mark_all_dirty();
    schedule_refresh();

    while (!lifecycle.dead && refresh_promise) {
      const pending_refresh = refresh_promise;
      await pending_refresh;
    }
  }

  function dispose() {
    if (lifecycle.dead) return;

    queued_again = false;
    dirty_targets.clear();
    for (const remove_listener of cleanup.splice(0)) remove_listener();
    lifecycle.dispose();
  }

  attach_observers();

  schedule_refresh();

  // `budget` lets a host show the frame budget and tune it while it runs.
  return {
    refresh,
    dispose,
    budget: { report: budget.report, tune: budget.tune },
  };
}
