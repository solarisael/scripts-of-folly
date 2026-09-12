import {
  marker_candidate_from_child,
  find_sibling_close_marker,
  append_wrapped_children,
} from "./marker_tree_utils.js";
import {
  build_ix_span_html,
  parse_ix_marker_descriptor,
  split_ix_markers,
  parse_open_marker_only,
  is_close_marker_only,
  emit_ix_sanitization_warning,
} from "./interaction_markers/inline.js";

const wrap_sibling_marker = (children, index, output, open_marker, options) => {
  if (!open_marker.descriptor) {
    emit_ix_sanitization_warning(
      open_marker.raw_descriptor,
      options.warn,
      options.warning_cache,
    );
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
  const opening_html = build_ix_span_html(open_marker.descriptor, "", {
    door_href: open_marker.descriptor.door_href,
  }).replace("></span>", ">");
  append_wrapped_children(
    output,
    children,
    index,
    close_index,
    opening_html,
    "</span>",
  );
  return close_index;
};

const append_inline_candidate = (output, child, candidate, options) => {
  if (candidate.source_kind !== "text") {
    output.push(child);
    return;
  }
  const transformed_nodes = split_ix_markers(candidate.text, options);
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
  const open_marker = parse_open_marker_only(candidate.text);
  if (open_marker) {
    const close_index = wrap_sibling_marker(
      children,
      index,
      output,
      open_marker,
      options,
    );
    if (close_index >= index) {
      return close_index;
    }
  }
  append_inline_candidate(output, child, candidate, options);
  return index;
};

const transform_marker_children = (children, options) => {
  const output = [];
  for (let index = 0; index < children.length; index += 1) {
    index = transform_marker_child(children, index, output, options);
  }
  return output;
};

const transform_ix_markers_in_tree = (tree_node, options = {}) => {
  if (!tree_node || !Array.isArray(tree_node.children)) {
    return;
  }
  const warning_cache =
    options.warning_cache instanceof Set ? options.warning_cache : new Set();
  tree_node.children = transform_marker_children(tree_node.children, {
    warn: options.warn,
    warning_cache,
  });
  for (const child of tree_node.children) {
    transform_ix_markers_in_tree(child, { ...options, warning_cache });
  }
};

export {
  build_ix_span_html,
  parse_ix_marker_descriptor,
  split_ix_markers,
  transform_ix_markers_in_tree,
};
