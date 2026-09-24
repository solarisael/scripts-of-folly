import { collect_text_fx_effects_from_node } from "../js/text/intensity.js";

const TEXT_EFFECTS = Object.freeze([
  "glow",
  "neon",
  "shadow",
  "rift",
  "chroma",
  "blur",
  "flicker",
  "rainbow",
  "gradient",
  "aura",
  "etch",
  "whisper",
  "sigil_pulse",
  "veil",
  "cadence_oracular",
  "wiggle",
  "float",
  "shake",
  "glitch",
]);

const NATIVE_TEXT_EFFECTS = Object.freeze([
  "cadence",
  "cadence_soft",
  "cadence_childlike",
]);

const PANEL_EFFECTS = Object.freeze(["skill_popup"]);
const supported_effect_names = new Set([...TEXT_EFFECTS, ...PANEL_EFFECTS]);

function collect_effect_names(element) {
  return collect_text_fx_effects_from_node(element).filter((name) =>
    supported_effect_names.has(name),
  );
}

export {
  TEXT_EFFECTS,
  NATIVE_TEXT_EFFECTS,
  PANEL_EFFECTS,
  collect_effect_names,
};
