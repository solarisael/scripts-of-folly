import { normalize_text_fx_name } from "../js/contract.js";
import {
  marker_candidate_from_child,
  find_sibling_close_marker,
  append_wrapped_children,
} from "./marker_tree_utils.js";
import {
  parse_marker_effect_descriptor,
  emit_sanitization_warning,
  is_inline_stack_effect,
  text_fx_effect_names,
  text_fx_block_effect_names,
} from "./text_markers/descriptor.js";
import {
  build_text_fx_span_html,
  build_block_fx_open_html,
} from "./text_markers/rendering.js";
import { split_text_fx_markers } from "./text_markers/inline.js";

const open_marker_only_regex = /^\s*\{\{fx:([^}]+)\}\}\s*$/i;
const close_marker_only_regex = /^\s*\{\{\/fx\}\}\s*$/i;

const parse_open_marker_only = (raw_text) => {
  if (typeof raw_text !== "string") {
    return null;
  }
  const match = raw_text.match(open_marker_only_regex);
  if (!match) {
    return null;
  }
  return parse_marker_effect_descriptor(match[1]);
};

const is_close_marker_only = (raw_text) => {
  return typeof raw_text === "string" && close_marker_only_regex.test(raw_text);
};

const is_block_descriptor = (descriptor) => {
  return (
    descriptor.effect_names.length === 1 &&
    text_fx_block_effect_names.includes(descriptor.effect_names[0])
  );
};

const marker_wrapper_tags = (descriptor, is_block_effect) => {
  if (is_block_effect) {
    const opening_html = build_block_fx_open_html(descriptor.effect_names[0], {
      visual_intensity: descriptor.visual_intensity,
      motion_intensity: descriptor.motion_intensity,
      speed_intensity: descriptor.speed_intensity,
    });
    return { opening_html, closing_html: "</div>" };
  }
  const opening_html = build_text_fx_span_html(descriptor.effect_names, "", {
    visual_intensity: descriptor.visual_intensity,
    motion_intensity: descriptor.motion_intensity,
    speed_intensity: descriptor.speed_intensity,
    color: descriptor.color,
    effect_settings: descriptor.effect_settings,
  });
  return {
    opening_html: opening_html?.replace("></span>", ">"),
    closing_html: "</span>",
  };
};

const wrap_sibling_marker = (
  children,
  index,
  output,
  candidate,
  descriptor,
  options,
) => {
  emit_sanitization_warning(
    descriptor.warning_reasons,
    descriptor.raw_descriptor,
    descriptor.effect_names,
    options.warn,
    options.warning_cache,
  );
  const is_block_effect = is_block_descriptor(descriptor);
  if (is_block_effect && candidate.source_kind !== "paragraph") {
    output.push(children[index]);
    return index;
  }
  if (
    !is_block_effect &&
    !descriptor.effect_names.every(is_inline_stack_effect)
  ) {
    output.push(children[index]);
    return index;
  }
  const close_index = find_sibling_close_marker(
    children,
    index,
    is_close_marker_only,
  );
  if (close_index <= index) {
    return -1;
  }
  const { opening_html, closing_html } = marker_wrapper_tags(
    descriptor,
    is_block_effect,
  );
  if (!opening_html) {
    return -1;
  }
  append_wrapped_children(
    output,
    children,
    index,
    close_index,
    opening_html,
    closing_html,
  );
  return close_index;
};

const append_inline_candidate = (output, child, candidate, options) => {
  if (candidate.source_kind !== "text") {
    output.push(child);
    return;
  }
  const transformed_nodes = split_text_fx_markers(candidate.text, options);
  if (transformed_nodes.length) {
    output.push(...transformed_nodes);
    return;
  }
  output.push(child);
};

const transform_marker_child = (children, index, output, options) => {
  const child = children[index];
  const candidate = marker_candidate_from_child(child);
  if (!candidate) {
    output.push(child);
    return index;
  }
  const descriptor = parse_open_marker_only(candidate.text);
  if (descriptor) {
    const close_index = wrap_sibling_marker(
      children,
      index,
      output,
      candidate,
      descriptor,
      options,
    );
    if (close_index >= index) {
      return close_index;
    }
  }
  append_inline_candidate(output, child, candidate, options);
  return index;
};

const transform_text_fx_markers_in_tree = (tree_node, options = {}) => {
  if (!tree_node || !Array.isArray(tree_node.children)) {
    return;
  }
  const warning_cache =
    options.warning_cache instanceof Set ? options.warning_cache : new Set();
  const marker_options = { warn: options.warn, warning_cache };
  const next_children = [];
  for (let index = 0; index < tree_node.children.length; index += 1) {
    index = transform_marker_child(
      tree_node.children,
      index,
      next_children,
      marker_options,
    );
  }
  tree_node.children = next_children;
  for (const child of tree_node.children) {
    transform_text_fx_markers_in_tree(child, { ...options, warning_cache });
  }
};

export {
  build_block_fx_open_html,
  build_text_fx_span_html,
  normalize_text_fx_name,
  split_text_fx_markers,
  text_fx_block_effect_names,
  text_fx_effect_names,
  transform_text_fx_markers_in_tree,
};
