import { IX_BASE_CLASS, parse_ix_descriptor } from "../../js/contract.js";
import { escape_html } from "../marker_tree_utils.js";

const emit_ix_sanitization_warning = (raw_descriptor, warn, warning_cache) => {
  if (typeof warn !== "function" || warning_cache.has(raw_descriptor)) {
    return;
  }

  warning_cache.add(raw_descriptor);
  warn(
    `{{ix:${raw_descriptor}}} is not a valid interaction descriptor ` +
      `("trigger:action:payload" — trigger \u2208 {hover, click}, ` +
      `action \u2208 {preview, reveal, fetch}); left as literal text.`,
  );
};

const build_ix_span_html = (
  descriptor,
  text_content,
  { door_href = null } = {},
) => {
  const attribute_value = `${descriptor.trigger}:${descriptor.action}:${descriptor.payload}`;
  const door_attribute = door_href
    ? ` data-ix-href="${escape_html(door_href)}"`
    : "";

  return (
    `<span class="${IX_BASE_CLASS}" data-ix="${escape_html(attribute_value)}"` +
    `${door_attribute}>${escape_html(text_content)}</span>`
  );
};

// Descriptor grammar also allows an optional trailing `|door_href` segment on
// the payload for word-meaning popups that want a "go deeper" link once
// pinned: {{ix:hover:preview:a lantern kept lit past its oil|/codex/lantern}}
const split_payload_and_door_href = (raw_payload) => {
  const pipe_index = raw_payload.indexOf("|");

  if (pipe_index === -1) {
    return { payload: raw_payload, door_href: null };
  }

  return {
    payload: raw_payload.slice(0, pipe_index),
    door_href: raw_payload.slice(pipe_index + 1).trim() || null,
  };
};

const parse_ix_marker_descriptor = (raw_descriptor) => {
  const descriptor = parse_ix_descriptor(raw_descriptor);

  if (!descriptor) {
    return null;
  }

  const { payload, door_href } = split_payload_and_door_href(
    descriptor.payload,
  );

  return { ...descriptor, payload, door_href };
};

const marker_regex = /\{\{ix:([^}]+)\}\}([\s\S]*?)\{\{\/ix\}\}/gi;

const open_marker_only_regex = /^\s*\{\{ix:([^}]+)\}\}\s*$/i;
const close_marker_only_regex = /^\s*\{\{\/ix\}\}\s*$/i;

const parse_open_marker_only = (raw_text) => {
  if (typeof raw_text !== "string") {
    return null;
  }

  const match = raw_text.match(open_marker_only_regex);

  if (!match) {
    return null;
  }

  return {
    raw_descriptor: match[1],
    descriptor: parse_ix_marker_descriptor(match[1]),
  };
};

const is_close_marker_only = (raw_text) => {
  return typeof raw_text === "string" && close_marker_only_regex.test(raw_text);
};

// Single text node containing one or more complete `{{ix:...}}...{{/ix}}`
// spans — splits into interleaved text/html mdast nodes.
const split_ix_markers = (raw_text = "", options = {}) => {
  const warning_cache =
    options.warning_cache instanceof Set ? options.warning_cache : new Set();
  const result_nodes = [];
  let cursor = 0;

  marker_regex.lastIndex = 0;

  for (const marker_match of raw_text.matchAll(marker_regex)) {
    const match_start = marker_match.index ?? 0;
    const match_end = match_start + marker_match[0].length;
    const raw_descriptor = marker_match[1];
    const inner_text = marker_match[2];

    if (match_start > cursor) {
      result_nodes.push({
        type: "text",
        value: raw_text.slice(cursor, match_start),
      });
    }

    const descriptor = parse_ix_marker_descriptor(raw_descriptor);

    if (!descriptor) {
      emit_ix_sanitization_warning(raw_descriptor, options.warn, warning_cache);
      result_nodes.push({ type: "text", value: marker_match[0] });
    } else {
      result_nodes.push({
        type: "html",
        value: build_ix_span_html(descriptor, inner_text, {
          door_href: descriptor.door_href,
        }),
      });
    }

    cursor = match_end;
  }

  if (!result_nodes.length) {
    return [];
  }

  if (cursor < raw_text.length) {
    result_nodes.push({ type: "text", value: raw_text.slice(cursor) });
  }

  return result_nodes;
};

export {
  emit_ix_sanitization_warning,
  build_ix_span_html,
  parse_ix_marker_descriptor,
  parse_open_marker_only,
  is_close_marker_only,
  split_ix_markers,
};
