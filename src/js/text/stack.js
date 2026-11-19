import {
  TEXT_FX_TEXT_EFFECT_NAMES,
  TEXT_FX_COLOR_CAPABLE_EFFECT_NAMES,
  TEXT_FX_STACK_BLACKLIST_PAIRS,
  TEXT_FX_INTENSITY_MIN,
  TEXT_FX_INTENSITY_MAX,
} from "../contract.js";
import { build_text_fx_span_html } from "../../markdown/text_markers/rendering.js";
import { escape_html } from "../../markdown/marker_tree_utils.js";

const motion_effects = new Set([
  "neon",
  "flicker",
  "sigil_pulse",
  "wiggle",
  "float",
  "shake",
  "glitch",
  "drown",
]);
export const TEXT_STACK_EFFECTS = Object.freeze(
  TEXT_FX_TEXT_EFFECT_NAMES.map((name) =>
    Object.freeze({
      name,
      label: name
        .replaceAll("_", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase()),
      color: TEXT_FX_COLOR_CAPABLE_EFFECT_NAMES.includes(name),
      motion: motion_effects.has(name),
      intensity: !["cadence", "cadence_soft", "cadence_childlike"].includes(
        name,
      ),
    }),
  ),
);
const catalog = new Map(
  TEXT_STACK_EFFECTS.map((effect) => [effect.name, effect]),
);
const freeze = (effects) =>
  Object.freeze(effects.map((effect) => Object.freeze(effect)));

function setting(effect, channel, value) {
  const metadata = catalog.get(effect.name);
  if (channel === "color") {
    if (!metadata.color)
      throw new Error(`${metadata.label} has a fixed color treatment.`);
    if (value !== null && !/^#[0-9a-f]{6}$/i.test(value))
      throw new TypeError("Choose a six-digit hex color.");
    return value;
  }
  if (!["intensity", "motion", "speed"].includes(channel))
    throw new Error("Unknown effect channel.");
  if (channel === "intensity" && !metadata.intensity)
    throw new Error(`${metadata.label} is a fixed typography treatment.`);
  if (channel !== "intensity" && !metadata.motion)
    throw new Error(`${metadata.label} has no adjustable motion.`);
  if (
    !Number.isFinite(value) ||
    value < TEXT_FX_INTENSITY_MIN ||
    value > TEXT_FX_INTENSITY_MAX
  )
    throw new RangeError(
      `Effect values must be between ${TEXT_FX_INTENSITY_MIN} and ${TEXT_FX_INTENSITY_MAX}.`,
    );
  return value;
}

export function create_text_stack() {
  let effects = freeze([]);
  const locate = (name) => {
    const index = effects.findIndex((effect) => effect.name === name);
    if (index < 0) throw new Error("The effect is not in this stack.");
    return index;
  };
  const refusal = (name) => {
    if (!catalog.has(name)) return "Choose a supported text effect.";
    if (effects.some((effect) => effect.name === name))
      return "That effect is already in the stack.";
    const conflict = effects.find((effect) =>
      TEXT_FX_STACK_BLACKLIST_PAIRS.some(
        (pair) => pair.includes(name) && pair.includes(effect.name),
      ),
    );
    return conflict
      ? `${catalog.get(name).label} cannot be combined with ${catalog.get(conflict.name).label}.`
      : null;
  };
  return {
    get effects() {
      return effects;
    },
    refusal,
    add(name) {
      const reason = refusal(name);
      if (reason) throw new Error(reason);
      effects = freeze([
        ...effects,
        { name, intensity: 1, motion: 1, speed: 1, color: null },
      ]);
    },
    remove(name) {
      const index = locate(name);
      effects = freeze(effects.filter((effect, at) => at !== index));
    },
    move(name, offset) {
      const index = locate(name);
      if (!Number.isInteger(offset))
        throw new RangeError("An effect move needs an integer offset.");
      const next = index + offset;
      if (next < 0 || next >= effects.length || offset === 0) return false;
      const reordered = [...effects];
      reordered.splice(index, 1);
      reordered.splice(next, 0, effects[index]);
      effects = freeze(reordered);
      return true;
    },
    set(name, channel, value) {
      const index = locate(name);
      const next = setting(effects[index], channel, value);
      effects = freeze(
        effects.map((effect, at) =>
          at === index ? { ...effect, [channel]: next } : effect,
        ),
      );
    },
    html(text) {
      if (!effects.length) return `<span>${escape_html(String(text))}</span>`;
      const effect_settings = Object.fromEntries(
        effects.map((effect) => [
          effect.name,
          {
            visual_intensity: effect.intensity,
            motion_intensity: effect.motion,
            speed_intensity: effect.speed,
            color:
              effect.color === null
                ? null
                : { token: effect.color, css: effect.color },
          },
        ]),
      );
      return build_text_fx_span_html(
        effects.map((effect) => effect.name),
        String(text),
        { effect_settings },
      );
    },
  };
}
