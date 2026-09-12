import { TEXT_FX_INTENSITY_MAX, TEXT_FX_INTENSITY_MIN } from "../contract.js";
import {
  resolve_text_fx_effects_with_stack_rules,
  split_text_fx_tokens,
} from "./normalization.js";
const text_fx_intensity_min = TEXT_FX_INTENSITY_MIN;
const text_fx_intensity_max = TEXT_FX_INTENSITY_MAX;

const parse_text_fx_intensity_value = (raw_value) => {
  if (raw_value == null) {
    return null;
  }

  const parsed_value = Number.parseFloat(String(raw_value));

  if (!Number.isFinite(parsed_value)) {
    return null;
  }

  return Math.min(
    text_fx_intensity_max,
    Math.max(text_fx_intensity_min, parsed_value),
  );
};

const text_fx_effect_attribute_name = (effect_name, channel_name) => {
  const dashed_effect_name = effect_name.replaceAll("_", "-");

  return `data-text-fx-${dashed_effect_name}-${channel_name}`;
};

const text_fx_effect_var_name = (effect_name, channel_name) => {
  return `--text_fx_${effect_name}_${channel_name}`;
};

const collect_text_fx_effects_from_node = (node_value) => {
  if (!(node_value instanceof HTMLElement)) {
    return [];
  }

  const class_tokens = Array.from(node_value.classList);
  const data_tokens = split_text_fx_tokens(node_value.dataset.textFx ?? "");

  return resolve_text_fx_effects_with_stack_rules([
    ...class_tokens,
    ...data_tokens,
  ]);
};

const apply_text_fx_effect_vars = (node_value, effect_names) => {
  for (const effect_name of effect_names) {
    const visual_intensity = parse_text_fx_intensity_value(
      node_value.getAttribute(
        text_fx_effect_attribute_name(effect_name, "intensity"),
      ),
    );
    const motion_intensity = parse_text_fx_intensity_value(
      node_value.getAttribute(
        text_fx_effect_attribute_name(effect_name, "motion"),
      ),
    );
    const speed_intensity = parse_text_fx_intensity_value(
      node_value.getAttribute(
        text_fx_effect_attribute_name(effect_name, "speed"),
      ),
    );
    const visual_var_name = text_fx_effect_var_name(effect_name, "intensity");
    const motion_var_name = text_fx_effect_var_name(effect_name, "motion");
    const speed_var_name = text_fx_effect_var_name(effect_name, "speed");

    const channel_names = [
      [visual_var_name, visual_intensity],
      [motion_var_name, motion_intensity],
      [speed_var_name, speed_intensity],
    ];
    for (const [name, value] of channel_names) {
      if (value == null) {
        remove_css_property_if_present(node_value.style, name);
      } else {
        set_css_property_if_changed(node_value.style, name, String(value));
      }
    }
  }
};

const set_css_property_if_changed = (style, name, value) => {
  if (style.getPropertyValue(name) !== value) {
    style.setProperty(name, value);
  }
};

const remove_css_property_if_present = (style, name) => {
  if (style.getPropertyValue(name) !== "") {
    style.removeProperty(name);
  }
};

const apply_text_fx_intensity_vars = (
  node_value,
  effect_names = collect_text_fx_effects_from_node(node_value),
) => {
  if (!(node_value instanceof HTMLElement)) {
    return;
  }
  const visual_intensity = parse_text_fx_intensity_value(
    node_value.dataset.textFxIntensity,
  );
  const motion_intensity = parse_text_fx_intensity_value(
    node_value.dataset.textFxMotion,
  );
  const speed_intensity = parse_text_fx_intensity_value(
    node_value.dataset.textFxSpeed,
  );

  const channel_names = [
    [
      "--text_fx_marker_intensity",
      "--block_fx_marker_intensity",
      visual_intensity,
    ],
    ["--text_fx_marker_motion", "--block_fx_marker_motion", motion_intensity],
    ["--text_fx_marker_speed", "--block_fx_marker_speed", speed_intensity],
  ];

  for (const [text_name, block_name, value] of channel_names) {
    if (value == null) {
      remove_css_property_if_present(node_value.style, text_name);
      remove_css_property_if_present(node_value.style, block_name);
      continue;
    }
    const string_value = String(value);
    set_css_property_if_changed(node_value.style, text_name, string_value);
    set_css_property_if_changed(node_value.style, block_name, string_value);
  }

  apply_text_fx_effect_vars(node_value, effect_names);
};

export {
  parse_text_fx_intensity_value,
  collect_text_fx_effects_from_node,
  apply_text_fx_intensity_vars,
};
