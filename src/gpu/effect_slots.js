// The slot of each text effect in the uniform arrays of the text shader
// (./wgsl.js). The backend packs each effect's settings into its slot.
export const EFFECT_SLOTS = Object.freeze({
  glow: 0,
  neon: 1,
  shadow: 2,
  chroma: 3,
  blur: 4,
  flicker: 5,
  rainbow: 6,
  gradient: 7,
  aura: 8,
  etch: 9,
  whisper: 10,
  sigil_pulse: 11,
  veil: 12,
  cadence_oracular: 13,
  wiggle: 14,
  float: 15,
  shake: 16,
  glitch: 17,
  skill_popup: 18,
  rift: 19,
  drown: 20,
});

export const EFFECT_SLOT_COUNT = Object.keys(EFFECT_SLOTS).length;
