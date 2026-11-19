export function rectangle(value) {
  const rect = Array.from(value);
  if (
    rect.length !== 4 ||
    !rect.every(Number.isFinite) ||
    rect[2] <= 0 ||
    rect[3] <= 0
  )
    throw new RangeError(
      "A composition rectangle needs finite x, y and positive width, height.",
    );
  return Object.freeze(rect);
}

export function image_size(source) {
  const width = source?.videoWidth || source?.naturalWidth || source?.width;
  const height = source?.videoHeight || source?.naturalHeight || source?.height;
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1
  )
    throw new RangeError(
      "A composition image must have positive integer dimensions.",
    );
  return [width, height];
}

const source_effect = (value) => {
  if (!["image", "neon"].includes(value))
    throw new RangeError(`Unknown source effect: ${value}`);
  return value;
};

export function create_input(layer, source, options, remove, output) {
  if (layer.disposed) throw new Error("Cannot compose a disposed layer.");
  const blur = source === null;
  let image = source;
  if (!blur) image_size(source);
  let bounds = rectangle(options.rect ?? [0, 0, ...image_size(source)]);
  let radius = options.radius ?? 8;
  let revision = 1;
  let image_revision = 1;
  let effect = options.effect ?? "blur";
  let source_style = source_effect(options.source_effect ?? "image");
  const check_effect = (value) => {
    if (!["blur", "refraction", "chroma"].includes(value))
      throw new RangeError(`Unknown backdrop effect: ${value}`);
    return value;
  };
  if (blur) effect = check_effect(effect);
  let disposed = false;
  const live = () => {
    if (disposed || layer.disposed)
      throw new Error("The composition input is disposed.");
  };
  const check_radius = (value) => {
    if (!Number.isFinite(value) || value < 0 || value > 64)
      throw new RangeError(
        "The blur radius must be between 0 and 64 CSS pixels.",
      );
    return value;
  };
  if (blur) radius = check_radius(radius);
  const input = {
    layer,
    blur,
    get source() {
      return image;
    },
    get rect() {
      return bounds;
    },
    get radius() {
      return radius;
    },
    get effect() {
      return effect;
    },
    get source_effect() {
      return source_style;
    },
    get revision() {
      return revision;
    },
    get image_revision() {
      return image_revision;
    },
    get disposed() {
      return disposed || layer.disposed;
    },
    update(next = image) {
      live();
      if (next === output)
        throw new Error("A compositor cannot sample its own output.");
      if (blur) throw new Error("A backdrop plane has no source image.");
      image_size(next);
      image = next;
      revision++;
      image_revision++;
    },
    set_rect(next) {
      live();
      bounds = rectangle(next);
      revision++;
    },
    set_radius(next) {
      live();
      if (!blur) throw new Error("A source plane has no blur radius.");
      radius = check_radius(next);
      revision++;
    },
    set_effect(next) {
      live();
      if (!blur) throw new Error("A source plane has no backdrop effect.");
      effect = check_effect(next);
      revision++;
    },
    set_source_effect(next) {
      live();
      if (blur) throw new Error("A backdrop plane has no source effect.");
      source_style = source_effect(next);
      revision++;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      layer.disown(input.dispose);
      remove(input);
    },
  };
  layer.own(input.dispose);
  return input;
}
