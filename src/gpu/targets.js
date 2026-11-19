// Which elements are GPU effect targets. These functions read the DOM and
// keep no state.
import { collect_effect_names, TEXT_EFFECTS, PANEL_EFFECTS } from "./registry.js";
import { CAPTURE_ATTRIBUTE } from "./markers.js";

export function is_element(value) {
  return value?.nodeType === 1;
}

// A node that the runtime made: a canvas, a capture in progress, or a probe.
export function is_internal_node(value) {
  return (
    is_element(value) &&
    (value.matches?.(
      ".folly-gpu-canvas, .folly-gpu-presenter, [data-folly-transition]",
    ) ||
      value.hasAttribute(CAPTURE_ATTRIBUTE) ||
      value.hasAttribute("data-folly-probe"))
  );
}

export function element_is_in_root(element, root) {
  return root.nodeType === 9
    ? root.documentElement.contains(element)
    : root.contains(element);
}

// The effects that `element` names itself.
export function element_names(element) {
  return collect_effect_names(element).filter(
    (name) => TEXT_EFFECTS.includes(name) || PANEL_EFFECTS.includes(name),
  );
}

export function is_panel_target(names) {
  return names.some((name) => PANEL_EFFECTS.includes(name));
}

function target_is_transitioning(element) {
  return element.closest?.(".sol__pretext_transitioning") != null;
}

// The effects of `element`: its own, and the text effects of its ancestors.
// A panel effect decorates its own box, so descendants do not inherit it.
export function effective_effect_names(element) {
  const lineage = [];
  let current = element;
  while (current && current.nodeType === 1) {
    lineage.unshift(current);
    current = current.parentElement;
  }
  const names = [];
  for (const owner of lineage) {
    for (const name of element_names(owner)) {
      if (owner !== element && PANEL_EFFECTS.includes(name)) continue;
      if (!names.includes(name)) names.push(name);
    }
  }
  return names;
}

// Inherited effects keep the parameters and colour of their naming element.
export function effect_owner(element, name) {
  for (
    let current = element;
    is_element(current);
    current = current.parentElement
  ) {
    if (element_names(current).includes(name)) return current;
  }
  return element;
}

function capture_representable(element) {
  const unsupported =
    "button,input,select,textarea,audio,video,canvas:not(.folly-gpu-presenter),svg,iframe,object,embed";
  return (
    !element.matches?.(unsupported) && !element.querySelector?.(unsupported)
  );
}

function target_is_representable(element) {
  const names = effective_effect_names(element);
  return is_panel_target(names) || capture_representable(element);
}

// All targets in `query_root`, in document order.
export function find_targets(query_root) {
  const targets = [];

  if (
    is_element(query_root) &&
    effective_effect_names(query_root).length &&
    target_is_representable(query_root) &&
    !target_is_transitioning(query_root)
  )
    targets.push(query_root);

  for (const element of query_root.querySelectorAll?.("*") || []) {
    if (
      !is_internal_node(element) &&
      element_names(element).length &&
      target_is_representable(element) &&
      !target_is_transitioning(element)
    )
      targets.push(element);
  }

  return targets;
}

// The nearest element at or above `node` that names an effect.
export function find_effect_target(node, query_root) {
  let current = is_element(node) ? node : node?.parentElement;
  while (current && current !== query_root) {
    if (element_names(current).length > 0) return current;
    current = current.parentElement;
  }
  return is_element(query_root) && element_names(query_root).length > 0
    ? query_root
    : null;
}
