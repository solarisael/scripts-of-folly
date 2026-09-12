import {
  TEXT_FX_BLOCK_BASE_CLASS,
  TEXT_FX_EFFECT_CLASS_MAP,
  TEXT_FX_TEXT_BASE_CLASS,
  text_fx_block_class_for,
  text_fx_is_inline_block_effect,
  text_fx_is_text_effect,
  text_fx_text_class_for,
} from "./contract.js";

const text_fx_effect_class_map = TEXT_FX_EFFECT_CLASS_MAP;

import {
  parse_combat_token_segments,
  build_combat_token_fragment,
  hydrate_combat_tokens,
} from "./text/combat.js";
import {
  normalize_text_fx_token,
  resolve_text_fx_class,
  split_text_fx_tokens,
} from "./text/normalization.js";
import {
  parse_text_fx_intensity_value,
  collect_text_fx_effects_from_node,
  apply_text_fx_intensity_vars,
} from "./text/intensity.js";

const resolve_text_fx_class_for_node = (effect_name, node_value) => {
  if (
    text_fx_is_text_effect(effect_name) ||
    (text_fx_is_inline_block_effect(effect_name) &&
      node_value.classList.contains(TEXT_FX_TEXT_BASE_CLASS))
  ) {
    return text_fx_text_class_for(effect_name);
  }

  return text_fx_block_class_for(effect_name);
};

const collect_text_fx_classes_from_node = (
  node_value,
  resolved_effects = null,
) => {
  if (!(node_value instanceof HTMLElement)) {
    return [];
  }

  const effect_names =
    resolved_effects ?? collect_text_fx_effects_from_node(node_value);
  const classes_to_apply = new Set();

  for (const effect_name of effect_names) {
    const resolved_class = resolve_text_fx_class_for_node(
      effect_name,
      node_value,
    );

    if (resolved_class) {
      classes_to_apply.add(resolved_class);
    }
  }

  return Array.from(classes_to_apply);
};

const apply_text_fx_classes = (node_value) => {
  if (!(node_value instanceof HTMLElement)) {
    return [];
  }

  const resolved_effects = collect_text_fx_effects_from_node(node_value);
  const effect_classes = collect_text_fx_classes_from_node(
    node_value,
    resolved_effects,
  );

  if (!effect_classes.length) {
    return [];
  }

  const has_text_effect = effect_classes.some((class_name) =>
    class_name.startsWith(`${TEXT_FX_TEXT_BASE_CLASS}_`),
  );
  const has_block_effect = effect_classes.some((class_name) =>
    class_name.startsWith(`${TEXT_FX_BLOCK_BASE_CLASS}_`),
  );

  if (has_text_effect) {
    node_value.classList.add(TEXT_FX_TEXT_BASE_CLASS);
  }

  if (has_block_effect) {
    node_value.classList.add(TEXT_FX_BLOCK_BASE_CLASS);
  }

  for (const class_name of effect_classes) {
    node_value.classList.add(class_name);
  }

  apply_text_fx_intensity_vars(node_value, resolved_effects);

  if (node_value.dataset.textFxHydrated !== "true") {
    node_value.dataset.textFxHydrated = "true";
  }

  return effect_classes;
};

const text_fx_node_selector =
  "[data-text-fx], [class*='fx-'], [class*='sol__text_fx'], [class*='sol__block_fx']";

const find_text_fx_nodes = (root_node = document) => {
  if (!root_node || typeof root_node.querySelectorAll !== "function") {
    return [];
  }

  const text_fx_nodes = Array.from(
    root_node.querySelectorAll(text_fx_node_selector),
  );

  if (
    root_node instanceof HTMLElement &&
    root_node.matches(text_fx_node_selector)
  ) {
    return [root_node, ...text_fx_nodes];
  }

  return text_fx_nodes;
};

const hydrate_text_effects = (root_node = document) => {
  const text_fx_nodes = find_text_fx_nodes(root_node);

  for (const text_fx_node of text_fx_nodes) {
    apply_text_fx_classes(text_fx_node);
  }

  hydrate_combat_tokens(root_node);
};

export {
  apply_text_fx_classes,
  apply_text_fx_intensity_vars,
  build_combat_token_fragment,
  collect_text_fx_classes_from_node,
  hydrate_combat_tokens,
  hydrate_text_effects,
  normalize_text_fx_token,
  parse_combat_token_segments,
  parse_text_fx_intensity_value,
  resolve_text_fx_class,
  split_text_fx_tokens,
  text_fx_effect_class_map,
};
