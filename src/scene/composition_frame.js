import { field_textures } from "./passes.js";

const NO_READS = Object.freeze([]);

function gpu_draw(pass, { input, opacity }, prepared, now) {
  if (input.disposed) throw new Error("A GPU input was disposed before its draw.");
  const result = input.draw(pass, {
    state: prepared.get(input).built,
    size: pass.target.size,
    level: 0,
    now,
    opacity,
    reads: input.reads?.length ? field_textures(input.reads, prepared) : NO_READS,
  });
  if (typeof result?.then === "function")
    throw new TypeError("A composition draw must be synchronous.");
}

function plane_values(size, rect, mode, radius, opacity, x = 0, y = 0) {
  return { frame: [...size, mode, radius], rect, effect: [opacity, x, y, 0] };
}

// Only these treatments sample the composition. An ordinary GPU plane never
// binds the texture that the open pass is writing.
function image_draw(pass, { input, opacity }, state, images, background, size, density) {
  if (input.disposed) throw new Error("An image input was disposed before its draw.");
  const rect = input.rect.map((value) => value * density);
  const radius = input.radius * density;
  const first = state.effects[0];
  if (!input.blur) {
    return first.set({
      plane: plane_values(size, rect, input.source_effect === "neon" ? 6 : 0, 0, opacity),
      backdrop: background.color,
      image: state.texture,
    });
  }
  if (input.effect !== "blur") {
    return first.set({
      plane: plane_values(size, rect, input.effect === "refraction" ? 4 : 5, radius, opacity),
      backdrop: background.color,
    });
  }
  first.set({
    plane: plane_values(size, rect, 1, radius, opacity, 1, 0),
    backdrop: background.color,
  });
  pass(images.scratch, first);
  return state.effects[1].set({
    plane: plane_values(size, rect, 2, radius, opacity, 0, 1),
    backdrop: images.scratch.color,
    image: background.color,
  });
}

export function draw_composition(resources, plan, size, density, now) {
  const { api, gpu, prepared, surface, images } = resources;
  let passes = 0;
  api.frame(gpu, (frame) => {
    const pass = (target, body) => {
      frame.pass(target, body);
      passes++;
    };
    for (const field of plan.fields) {
      pass(prepared.get(field.input).target, (open) => gpu_draw(open, field, prepared, now));
    }
    let current;
    for (const [index, { base, planes }] of plan.groups.entries()) {
      const effect = base && image_draw(pass, base, prepared.get(base.input), images, current, size, density);
      current = plan.groups.length === 1 ? surface : images.pair[index % 2];
      pass(current, (open) => {
        if (effect) open.draw(effect);
        for (const plane of planes) gpu_draw(open, plane, prepared, now);
      });
    }
    if (current !== surface) {
      images.present.set({
        plane: plane_values(size, [0, 0, ...size], 3, 0, 1),
        backdrop: current.color,
      });
      pass(surface, images.present);
    }
  });
  return passes;
}
