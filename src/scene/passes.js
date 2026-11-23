// A group starts with a clear or a draw that samples the previous group.
// Direct planes share that group's open color attachment.
export function composition_plan(layers, prepared) {
  const ordered = layers.toSorted((a, b) => a.order - b.order);
  const fields = [];
  const build = [];
  const groups = [{ base: null, planes: [] }];
  let dynamic = false;
  for (const entry of ordered) {
    const { input } = entry;
    if (!prepared.has(input)) build.push(input);
    if (input.kind === "field") {
      dynamic = true;
      fields.push(entry);
    } else if (input.kind === "plane") {
      dynamic = true;
      groups.at(-1).planes.push(entry);
    } else {
      groups.push({ base: entry, planes: [] });
    }
  }
  return { ordered, fields, build, groups, dynamic };
}

export function field_textures(reads, prepared) {
  return reads.map((field) => {
    const state = prepared.get(field);
    if (!state?.target) throw new Error("A field read by a plane is no longer live.");
    return state.target.color;
  });
}

export function scaled_size(width, height, scale, max_pixels, limit) {
  const w = Math.max(1, Math.floor(width * scale));
  const h = Math.max(1, Math.floor(height * scale));
  if (w * h > max_pixels || w > limit || h > limit)
    throw new RangeError("Composition dimensions exceed the GPU or pixel budget.");
  return [w, h];
}
