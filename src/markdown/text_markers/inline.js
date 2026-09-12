import {
  parse_marker_effect_descriptor,
  emit_sanitization_warning,
  is_inline_stack_effect,
} from "./descriptor.js";
import { build_text_fx_span_html_from_nodes } from "./rendering.js";

const marker_boundary_regex = /\{\{fx:([^}]+)\}\}|\{\{\/fx\}\}/gi;

const marker_match_range = (match) => {
  const index = match.index ?? 0;
  return { index, end_index: index + match[0].length };
};

const find_next_text_fx_open_marker = (source_text, start_index) => {
  marker_boundary_regex.lastIndex = start_index;
  for (const match of source_text.matchAll(marker_boundary_regex)) {
    if (match[1] !== undefined) {
      return { ...marker_match_range(match), raw_descriptor: match[1] };
    }
  }
  return null;
};

const find_matching_text_fx_close_marker = (source_text, start_index) => {
  let depth = 1;
  marker_boundary_regex.lastIndex = start_index;
  for (const match of source_text.matchAll(marker_boundary_regex)) {
    if (match[1] !== undefined) {
      depth += 1;
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      return marker_match_range(match);
    }
  }
  return null;
};

const render_inline_marker = (
  source_text,
  open_marker,
  close_marker,
  options,
) => {
  const full_match = source_text.slice(
    open_marker.index,
    close_marker.end_index,
  );
  const descriptor = parse_marker_effect_descriptor(open_marker.raw_descriptor);
  if (!descriptor) {
    return { type: "text", value: full_match };
  }
  if (!descriptor.effect_names.every(is_inline_stack_effect)) {
    return { type: "text", value: full_match };
  }
  emit_sanitization_warning(
    descriptor.warning_reasons,
    descriptor.raw_descriptor,
    descriptor.effect_names,
    options.warn,
    options.warning_cache,
  );
  const inner_nodes = split_text_fx_markers(
    source_text.slice(open_marker.end_index, close_marker.index),
    { ...options, warning_cache: options.warning_cache },
  );
  const html_value = build_text_fx_span_html_from_nodes(
    descriptor,
    inner_nodes,
  );
  return { type: "html", value: html_value ?? full_match };
};

const split_text_fx_markers = (raw_text = "", options = {}) => {
  const source_text = String(raw_text);
  const output_nodes = [];
  let cursor = 0;
  while (cursor < source_text.length) {
    const open_marker = find_next_text_fx_open_marker(source_text, cursor);
    if (!open_marker) {
      output_nodes.push({ type: "text", value: source_text.slice(cursor) });
      break;
    }
    if (cursor < open_marker.index) {
      output_nodes.push({
        type: "text",
        value: source_text.slice(cursor, open_marker.index),
      });
    }
    const close_marker = find_matching_text_fx_close_marker(
      source_text,
      open_marker.end_index,
    );
    if (!close_marker) {
      output_nodes.push({
        type: "text",
        value: source_text.slice(open_marker.index),
      });
      break;
    }
    output_nodes.push(
      render_inline_marker(source_text, open_marker, close_marker, options),
    );
    cursor = close_marker.end_index;
  }
  return output_nodes;
};

export { split_text_fx_markers };
