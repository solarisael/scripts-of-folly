// Textures, samplers and DataTexture for the WebGL2 leg.
//
// StorageBuffer has no WebGL2 form. Use DataTexture on both backends and
// rewrite the WGSL once, so one source serves both legs:
//   @group(0) @binding(1) var<storage, read> actors: array<Actor>;
// becomes
//   @group(0) @binding(1) var actors: texture_2d<f32>;
//   fn actor_texel(index: u32) -> vec4f {
//     return textureLoad(actors, vec2u(index % 1024u, index / 1024u), 0);
//   }
// Element i of a struct made of N vec4f lives at texels i * N .. i * N + N - 1.
// Pack scalars into vec4f lanes; read u32 data with bitcast<u32>(texel.x).
// Bind `data.texture` and never pair it with a sampler: rgba32float does not
// filter.

const DATA_TEXTURE_WIDTH = 1024;

const TEXTURE_FORMATS = {
  rgba8unorm: { internal: "RGBA8", type: "UNSIGNED_BYTE", array: Uint8Array },
  "rgba8unorm-srgb": {
    internal: "SRGB8_ALPHA8",
    type: "UNSIGNED_BYTE",
    array: Uint8Array,
  },
  rgba16float: { internal: "RGBA16F", type: "HALF_FLOAT", array: Uint16Array },
  rgba32float: { internal: "RGBA32F", type: "FLOAT", array: Float32Array },
};

const ADDRESS_MODES = {
  "clamp-to-edge": "CLAMP_TO_EDGE",
  repeat: "REPEAT",
  "mirror-repeat": "MIRRORED_REPEAT",
};

const texture_format = (format) => {
  const shape = TEXTURE_FORMATS[format];
  if (!shape) throw new Error(`The WebGL2 leg has no "${format}" texture.`);
  return shape;
};

export const allocate_texture = (gl, raw, [width, height]) => {
  const shape = texture_format(raw.format);
  raw.width = Math.max(1, Math.round(width));
  raw.height = Math.max(1, Math.round(height));
  gl.bindTexture(gl.TEXTURE_2D, raw.handle);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl[shape.internal],
    raw.width,
    raw.height,
    0,
    gl.RGBA,
    gl[shape.type],
    null,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
};

export const create_texture = (gl, { size, format = "rgba8unorm", label }) => {
  const raw = { handle: gl.createTexture(), format, width: 1, height: 1 };
  allocate_texture(gl, raw, size);
  const texture = {
    gpu: raw,
    format,
    label,
    get size() {
      return [raw.width, raw.height];
    },
    dispose() {
      gl.deleteTexture(raw.handle);
    },
  };
  // vgpu binds `texture.view`; here the view is the texture itself.
  texture.view = texture;
  return texture;
};

export const write_texture = (gl, destination, data, layout = {}, size) => {
  if (destination.origin) {
    throw new Error("The WebGL2 leg writes whole textures from the origin.");
  }
  const raw = destination.texture;
  const shape = texture_format(raw.format);
  const [width, height] = Array.isArray(size)
    ? size
    : [size.width, size.height ?? 1];
  const bytes = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
  const offset = layout.offset ?? 0;
  const pixels = new shape.array(
    bytes.buffer,
    bytes.byteOffset + offset,
    Math.floor((bytes.byteLength - offset) / shape.array.BYTES_PER_ELEMENT),
  );
  const texel_bytes = shape.array.BYTES_PER_ELEMENT * 4;
  gl.bindTexture(gl.TEXTURE_2D, raw.handle);
  gl.pixelStorei(gl.UNPACK_ROW_LENGTH, (layout.bytesPerRow ?? 0) / texel_bytes);
  gl.texSubImage2D(
    gl.TEXTURE_2D,
    0,
    0,
    0,
    width,
    height,
    gl.RGBA,
    gl[shape.type],
    pixels,
  );
  gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
};

// Mirrors queue.copyExternalImageToTexture for a canvas or an image. Row 0 of
// the source lands on row 0 of the texture, as on WebGPU without flipY.
export const copy_external_image = (gl, source, destination, size) => {
  if (destination.origin) {
    throw new Error("The WebGL2 leg copies whole images from the origin.");
  }
  const raw = destination.texture;
  if (texture_format(raw.format).type !== "UNSIGNED_BYTE") {
    throw new Error("The WebGL2 leg copies images into 8-bit textures only.");
  }
  const [width, height] = Array.isArray(size)
    ? size
    : [size.width, size.height ?? 1];
  gl.bindTexture(gl.TEXTURE_2D, raw.handle);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, Boolean(source.flipY));
  gl.pixelStorei(
    gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,
    Boolean(destination.premultipliedAlpha),
  );
  gl.texSubImage2D(
    gl.TEXTURE_2D,
    0,
    0,
    0,
    width,
    height,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    source.source,
  );
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
};

export const sampler = (gpu, options = {}) => {
  const { gl } = gpu;
  const handle = gl.createSampler();
  const address = (mode = "clamp-to-edge") => {
    if (!ADDRESS_MODES[mode]) {
      throw new Error(`The WebGL2 leg has no "${mode}" address mode.`);
    }
    return gl[ADDRESS_MODES[mode]];
  };
  const filter = (mode) => (mode === "linear" ? gl.LINEAR : gl.NEAREST);
  gl.samplerParameteri(
    handle,
    gl.TEXTURE_MIN_FILTER,
    filter(options.minFilter),
  );
  gl.samplerParameteri(
    handle,
    gl.TEXTURE_MAG_FILTER,
    filter(options.magFilter),
  );
  gl.samplerParameteri(
    handle,
    gl.TEXTURE_WRAP_S,
    address(options.addressModeU),
  );
  gl.samplerParameteri(
    handle,
    gl.TEXTURE_WRAP_T,
    address(options.addressModeV),
  );
  return {
    handle,
    label: options.label,
    filtering: options.minFilter === "linear" || options.magFilter === "linear",
  };
};

const bound_texture = (state, binding) => {
  const raw = state.bag[binding.name]?.gpu;
  if (!raw?.handle) {
    throw new Error(`${state.label}: texture "${binding.name}" is not set.`);
  }
  return raw;
};

const paired_sampler = (state, binding) => {
  if (!binding.sampler) return null;
  const paired = state.bag[binding.sampler];
  if (!paired?.handle) {
    throw new Error(`${state.label}: sampler "${binding.sampler}" is not set.`);
  }
  return paired;
};

export const bind_texture = (state, binding) => {
  const { gl, float_linear } = state.gpu;
  const raw = bound_texture(state, binding);
  const paired = paired_sampler(state, binding);
  const filters_float = paired?.filtering && raw.format === "rgba32float";
  if (filters_float && !float_linear) {
    throw new Error(
      `${state.label}: "${binding.name}" is rgba32float; read it with textureLoad.`,
    );
  }
  gl.activeTexture(gl.TEXTURE0 + binding.unit);
  gl.bindTexture(gl.TEXTURE_2D, raw.handle);
  gl.bindSampler(binding.unit, paired?.handle ?? null);
};

export const DataTexture = (gpu, { size, label }) => {
  const texels = Math.max(1, Math.ceil(size / 16));
  const rows = Math.ceil(texels / DATA_TEXTURE_WIDTH);
  const texture = gpu.device.createTexture({
    kind: "2d",
    size: [DATA_TEXTURE_WIDTH, rows],
    format: "rgba32float",
    usage: ["texture_binding", "copy_dst"],
    label,
  });
  const staging = new ArrayBuffer(DATA_TEXTURE_WIDTH * rows * 16);
  const words = new Uint32Array(staging);
  const floats = new Float32Array(staging);
  return {
    texture,
    size,
    rows,
    write(data) {
      const source = ArrayBuffer.isView(data)
        ? new Uint32Array(data.buffer, data.byteOffset, data.byteLength / 4)
        : new Uint32Array(data);
      if (source.byteLength > size) {
        throw new RangeError(
          `${label}: ${source.byteLength} bytes exceed ${size}.`,
        );
      }
      words.set(source);
      words.fill(0, source.length);
      gpu.gpu.queue.writeTexture(
        { texture: texture.gpu },
        floats,
        { bytesPerRow: DATA_TEXTURE_WIDTH * 16, rowsPerImage: rows },
        { width: DATA_TEXTURE_WIDTH, height: rows },
      );
    },
    dispose() {
      texture.dispose();
    },
  };
};
