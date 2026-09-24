import * as THREE from "three/webgpu";
import * as tsl from "three/tsl";
import { BLUR_RADII } from "./blur_levels.js";
import { build_effect as build_glow } from "./effects/glow.js";
import { build_effect as build_neon } from "./effects/neon.js";
import { build_effect as build_shadow } from "./effects/shadow.js";
import { build_effect as build_rift } from "./effects/rift.js";
import { build_effect as build_chroma } from "./effects/chroma.js";
import { build_effect as build_blur } from "./effects/blur.js";
import { build_effect as build_flicker } from "./effects/flicker.js";
import { build_effect as build_rainbow } from "./effects/rainbow.js";
import { build_effect as build_gradient } from "./effects/gradient.js";
import { build_effect as build_aura } from "./effects/aura.js";
import { build_effect as build_etch } from "./effects/etch.js";
import { build_effect as build_whisper } from "./effects/whisper.js";
import { build_effect as build_sigil_pulse } from "./effects/sigil_pulse.js";
import { build_effect as build_veil } from "./effects/veil.js";
import { build_effect as build_cadence_oracular } from "./effects/cadence_oracular.js";
import { build_effect as build_wiggle } from "./effects/wiggle.js";
import { build_effect as build_float } from "./effects/float.js";
import { build_effect as build_shake } from "./effects/shake.js";
import { build_effect as build_glitch } from "./effects/glitch.js";
import { build_effect as build_skill_popup } from "./effects/skill_popup.js";

const builders = Object.freeze({
  glow: build_glow,
  neon: build_neon,
  shadow: build_shadow,
  rift: build_rift,
  chroma: build_chroma,
  blur: build_blur,
  flicker: build_flicker,
  rainbow: build_rainbow,
  gradient: build_gradient,
  aura: build_aura,
  etch: build_etch,
  whisper: build_whisper,
  sigil_pulse: build_sigil_pulse,
  veil: build_veil,
  cadence_oracular: build_cadence_oracular,
  wiggle: build_wiggle,
  float: build_float,
  shake: build_shake,
  glitch: build_glitch,
  skill_popup: build_skill_popup,
});

const motion_effects = new Set([
  "wiggle",
  "float",
  "shake",
  "glitch",
  "sigil_pulse",
]);

const finite = (value, fallback) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

function color_uniform(value, fallback) {
  const source = Array.isArray(value) ? value : fallback;
  return tsl.uniform(
    new THREE.Color(
      finite(source[0], fallback[0]),
      finite(source[1], fallback[1]),
      finite(source[2], fallback[2]),
    ),
    "color",
  );
}

function vector_uniform(value, fallback) {
  const source = Array.isArray(value) ? value : fallback;
  return tsl.uniform(
    new THREE.Vector2(
      Math.max(1, finite(source[0], fallback[0])),
      Math.max(1, finite(source[1], fallback[1])),
    ),
    "vec2",
  );
}

function parameter_nodes(values, time) {
  const source = values && typeof values === "object" ? values : {};
  return {
    time,
    intensity: tsl.uniform(finite(source.intensity, 1), "float"),
    motion: tsl.uniform(finite(source.motion, 1), "float"),
    speed: tsl.uniform(finite(source.speed, 1), "float"),
    accent: color_uniform(source.accent, [1, 1, 1]),
    base_color: color_uniform(source.base_color, [1, 1, 1]),
    size: vector_uniform(source.size, [1, 1]),
    font_size: tsl.uniform(Math.max(1, finite(source.font_size, 16)), "float"),
  };
}

function resolve_parameter_set(parameter_sets, name, index) {
  if (Array.isArray(parameter_sets)) return parameter_sets[index] ?? {};
  if (!parameter_sets || typeof parameter_sets !== "object") return {};
  return parameter_sets[name] ?? parameter_sets[index] ?? parameter_sets;
}

export function create_effect_material(
  texture,
  soft_texture,
  captured,
  effect_names = [],
  parameter_sets = {},
) {
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.colorSpace = THREE.NoColorSpace;
  soft_texture.minFilter = THREE.LinearFilter;
  soft_texture.magFilter = THREE.LinearFilter;
  soft_texture.wrapS = THREE.ClampToEdgeWrapping;
  soft_texture.wrapT = THREE.ClampToEdgeWrapping;
  soft_texture.colorSpace = THREE.NoColorSpace;
  soft_texture.needsUpdate = true;
  texture.needsUpdate = true;

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  material.premultipliedAlpha = false;

  const time = tsl.uniform(0, "float").setName("follyEffectTime");
  const source = tsl.texture(texture);
  const soft_source = tsl.texture(soft_texture);

  const sample = (coordinate, radius = null) => {
    const inside = tsl
      .step(tsl.vec2(0, 0), coordinate)
      .mul(tsl.step(coordinate, tsl.vec2(1, 1)));
    const mask = inside.x.mul(inside.y);
    let ink;

    if (radius && soft_texture !== texture) {
      const requested = tsl.max(
        radius.x.mul(captured.width),
        radius.y.mul(captured.height),
      );
      let level = tsl.float(BLUR_RADII.length - 1);
      for (let index = BLUR_RADII.length - 2; index >= 0; index -= 1) {
        const span = BLUR_RADII[index + 1] - BLUR_RADII[index];
        const fraction = tsl.clamp(
          requested.sub(BLUR_RADII[index]).div(span),
          0,
          1,
        );
        level = tsl.select(
          requested.lessThanEqual(BLUR_RADII[index + 1]),
          tsl.float(index).add(fraction),
          level,
        );
      }
      const lower = tsl.floor(level);
      const upper = tsl.min(lower.add(1), BLUR_RADII.length - 1);
      const layer = (index) =>
        soft_source.sample(
          tsl.vec2(
            coordinate.x,
            coordinate.y.add(index).div(BLUR_RADII.length),
          ),
        );
      ink = tsl.mix(layer(lower), layer(upper), tsl.fract(level));
    } else {
      ink = source.sample(coordinate);
    }

    return ink.mul(tsl.vec4(mask, mask, mask, mask));
  };

  const names = Array.from(effect_names ?? []);
  const entries = names.map((name, index) => {
    const builder = typeof name === "function" ? name : builders[name];
    if (typeof builder !== "function") {
      throw new Error(`Unknown GPU effect: ${String(name)}`);
    }
    const effect_name = typeof name === "string" ? name : `effect_${index}`;
    const values = resolve_parameter_set(parameter_sets, effect_name, index);
    return {
      name: effect_name,
      builder,
      params: parameter_nodes(values, time),
      color_override: values.color_override === true,
    };
  });

  let uv = tsl.uv();
  for (const entry of entries) {
    if (!motion_effects.has(entry.name)) continue;
    const result = entry.builder({
      tsl,
      uv,
      rgba: sample(uv),
      sample,
      params: entry.params,
      mode: "motion",
    });
    if (result?.uv) uv = result.uv;
  }

  let rgba = sample(uv);
  for (const entry of entries) {
    const result = entry.builder({
      tsl,
      uv,
      rgba,
      sample,
      params: entry.params,
      padding: captured.padding ?? 0,
      color_override: entry.color_override,
      mode: "shade",
    });
    if (result?.uv) uv = result.uv;
    if (result?.rgba) rgba = result.rgba;
  }

  material.fragmentNode = tsl.vec4(rgba.rgb, tsl.clamp(rgba.a, 0, 1));

  let disposed = false;
  return {
    material,
    time,
    dispose() {
      if (disposed) return;
      disposed = true;
      material.dispose();
    },
  };
}
