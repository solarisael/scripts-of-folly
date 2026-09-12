// Auto entry: hydrate text and interaction effects, then install the optional
// GPU controller once for this page.

import { hydrate_text_effects } from "./text_effects.js";
import { hydrate_interactions } from "./interactions.js";
import { install_pretext } from "../pretext/index.js";
import { install_gpu_effects } from "../gpu/runtime.js";

const hydrate_all = (root_node) => {
  hydrate_text_effects(root_node);
  hydrate_interactions(root_node);
};

const window_any = /** @type {any} */ (globalThis);

const fx_hydration_selector =
  "[data-text-fx], [class*='fx-'], [class*='sol__text_fx'], [class*='sol__block_fx'], [data-ix], [class*='sol__ix']";

const should_hydrate_attribute_mutation = (mutation_record) => {
  const target_node = mutation_record.target;

  if (!(target_node instanceof HTMLElement)) {
    return false;
  }

  const attribute_name = mutation_record.attributeName ?? "";

  if (
    attribute_name === "style" ||
    attribute_name === "data-text-fx-hydrated" ||
    attribute_name === "data-combat-tokens-hydrated"
  ) {
    return false;
  }

  if (
    attribute_name !== "class" &&
    attribute_name !== "data-ix" &&
    !attribute_name.startsWith("data-text-fx")
  ) {
    return false;
  }

  return target_node.matches(fx_hydration_selector);
};

const node_contains_hydration_target = (node_value) => {
  if (!(node_value instanceof HTMLElement)) {
    return false;
  }

  return (
    node_value.matches(fx_hydration_selector) ||
    node_value.querySelector(fx_hydration_selector) !== null
  );
};

const queued_hydration_roots = new Set();
let queued_hydration_frame = 0;

const schedule_hydrate_all = (root_node) => {
  if (!(root_node instanceof HTMLElement)) {
    return;
  }

  queued_hydration_roots.add(root_node);

  if (queued_hydration_frame) {
    return;
  }

  queued_hydration_frame = window.requestAnimationFrame(() => {
    const roots = Array.from(queued_hydration_roots);
    queued_hydration_roots.clear();
    queued_hydration_frame = 0;

    for (const root of roots) {
      hydrate_all(root);
    }
  });
};

if (
  typeof window !== "undefined" &&
  typeof document !== "undefined" &&
  !window_any.__text_fx_dom_ready_bound
) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => hydrate_all());
  } else {
    hydrate_all();
  }

  window_any.__text_fx_dom_ready_bound = true;
}

if (
  typeof window !== "undefined" &&
  typeof document !== "undefined" &&
  !window_any.__text_fx_after_swap_bound
) {
  document.body?.addEventListener("htmx:afterSwap", (event) => {
    const swap_target = event?.detail?.target;

    if (swap_target instanceof HTMLElement) {
      hydrate_all(swap_target);
      return;
    }

    hydrate_all();
  });

  window_any.__text_fx_after_swap_bound = true;
}

if (
  typeof window !== "undefined" &&
  typeof document !== "undefined" &&
  typeof MutationObserver !== "undefined" &&
  !window_any.__text_fx_mutation_observer_bound
) {
  const text_fx_mutation_observer = new MutationObserver((mutation_records) => {
    for (const mutation_record of mutation_records) {
      if (
        mutation_record.type === "attributes" &&
        should_hydrate_attribute_mutation(mutation_record)
      ) {
        schedule_hydrate_all(mutation_record.target);
        continue;
      }

      if (mutation_record.type !== "childList") {
        continue;
      }

      for (const added_node of mutation_record.addedNodes) {
        if (node_contains_hydration_target(added_node)) {
          schedule_hydrate_all(added_node);
        }
      }
    }
  });

  text_fx_mutation_observer.observe(document.documentElement, {
    attributes: true,
    childList: true,
    subtree: true,
  });

  window_any.__text_fx_mutation_observer = text_fx_mutation_observer;
  window_any.__text_fx_mutation_observer_bound = true;
}
if (typeof window !== "undefined" && typeof document !== "undefined") {
  const pretext_key = Symbol.for("scripts-of-folly.pretext");
  globalThis[pretext_key] ??= install_pretext();
  const gpu_key = Symbol.for("scripts-of-folly.gpu");
  globalThis[gpu_key] ??= install_gpu_effects();
}

export * from "./contract.js";
export * from "./text_effects.js";
export * from "./interactions.js";
