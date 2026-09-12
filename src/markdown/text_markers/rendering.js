import {
  TEXT_FX_TEXT_BASE_CLASS,
  TEXT_FX_BLOCK_BASE_CLASS,
  normalize_text_fx_name,
  text_fx_text_class_for,
  text_fx_block_class_for,
} from "../../js/contract.js";
import { escape_html } from "../marker_tree_utils.js";
import { text_fx_block_effect_names } from "./descriptor.js";

const intensity_channels = [
  ["visual_intensity", "intensity"],
  ["motion_intensity", "motion"],
  ["speed_intensity", "speed"],
];

const append_data_attributes = (chunks, settings, prefix) => {
  for (const [field, channel] of intensity_channels) {
    if (settings[field] != null) {
      chunks.push(`${prefix}${channel}="${settings[field]}"`);
    }
  }
  if (settings.color != null) {
    chunks.push(`${prefix}color="${settings.color.token}"`);
  }
};

const append_style_properties = (chunks, settings, prefix) => {
  for (const [field, channel] of intensity_channels) {
    if (settings[field] != null) {
      chunks.push(`${prefix}${channel}:${settings[field]}`);
    }
  }
  if (settings.color != null) {
    chunks.push(`${prefix}color:${settings.color.css}`);
  }
};

const build_text_fx_data_attributes = ({
  visual_intensity,
  motion_intensity,
  speed_intensity,
  color,
  effect_settings = {},
}) => {
  const chunks = [];
  append_data_attributes(
    chunks,
    { visual_intensity, motion_intensity, speed_intensity, color },
    "data-text-fx-",
  );
  for (const [effect_name, settings] of Object.entries(effect_settings)) {
    append_data_attributes(
      chunks,
      settings,
      `data-text-fx-${effect_name.replaceAll("_", "-")}-`,
    );
  }
  return chunks.length ? ` ${chunks.join(" ")}` : "";
};

const build_text_fx_style_attribute = ({
  visual_intensity,
  motion_intensity,
  speed_intensity,
  color,
  effect_settings = {},
}) => {
  const chunks = [];
  append_style_properties(
    chunks,
    { visual_intensity, motion_intensity, speed_intensity, color },
    "--text_fx_marker_",
  );
  for (const [effect_name, settings] of Object.entries(effect_settings)) {
    append_style_properties(chunks, settings, `--text_fx_${effect_name}_`);
  }
  return chunks.length ? ` style="${chunks.join(";")}"` : "";
};

const build_block_fx_style_attribute = ({
  visual_intensity,
  motion_intensity,
  speed_intensity,
}) => {
  const style_chunks = [];

  if (visual_intensity != null) {
    style_chunks.push(`--block_fx_marker_intensity:${visual_intensity}`);
  }

  if (motion_intensity != null) {
    style_chunks.push(`--block_fx_marker_motion:${motion_intensity}`);
  }

  if (speed_intensity != null) {
    style_chunks.push(`--block_fx_marker_speed:${speed_intensity}`);
  }

  if (!style_chunks.length) {
    return "";
  }

  return ` style="${style_chunks.join(";")}"`;
};

const build_text_fx_span_html = (
  effect_name_or_names,
  text_content,
  options = {},
) => {
  const raw_effect_names = Array.isArray(effect_name_or_names)
    ? effect_name_or_names
    : [effect_name_or_names];
  const safe_effect_names = raw_effect_names
    .map((raw_effect_name) => normalize_text_fx_name(raw_effect_name))
    .filter(Boolean);

  if (!safe_effect_names.length) {
    return null;
  }

  const data_attributes = build_text_fx_data_attributes(options);
  const style_attribute = build_text_fx_style_attribute(options);

  const fx_classes = safe_effect_names
    .map((safe_effect_name) => text_fx_text_class_for(safe_effect_name))
    .join(" ");

  return `<span class="${TEXT_FX_TEXT_BASE_CLASS} ${fx_classes}"${data_attributes}${style_attribute}>${escape_html(text_content)}</span>`;
};

const build_block_fx_open_html = (effect_name, options = {}) => {
  const safe_effect_name = normalize_text_fx_name(effect_name);

  if (
    !safe_effect_name ||
    !text_fx_block_effect_names.includes(safe_effect_name)
  ) {
    return null;
  }

  const data_attributes = build_text_fx_data_attributes(options);
  const style_attribute = build_block_fx_style_attribute(options);

  return `<div class="${TEXT_FX_BLOCK_BASE_CLASS} ${text_fx_block_class_for(safe_effect_name)}" data-text-fx="${safe_effect_name}"${data_attributes}${style_attribute}>`;
};

const text_fx_nodes_to_html = (nodes = []) => {
  return nodes
    .map((node) => {
      if (node.type === "html") {
        return node.value;
      }

      return escape_html(node.value ?? "");
    })
    .join("");
};

const build_text_fx_span_html_from_nodes = (descriptor, inner_nodes) => {
  const opening_html = build_text_fx_span_html(descriptor.effect_names, "", {
    visual_intensity: descriptor.visual_intensity,
    motion_intensity: descriptor.motion_intensity,
    speed_intensity: descriptor.speed_intensity,
    color: descriptor.color,
    effect_settings: descriptor.effect_settings,
  });

  if (!opening_html) {
    return null;
  }

  return `${opening_html.replace("></span>", ">")}${text_fx_nodes_to_html(
    inner_nodes,
  )}</span>`;
};

export {
  build_text_fx_span_html,
  build_block_fx_open_html,
  build_text_fx_span_html_from_nodes,
};
