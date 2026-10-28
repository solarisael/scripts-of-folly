// Uniform blocks for the WebGL2 leg.
//
// Uniform structs travel as std140 UBOs. Offsets come from the driver's
// reflection of naga's `layout(std140)` blocks, so set() takes the plain
// objects vgpu takes. naga escapes GLSL keywords with a trailing `_`
// (`step` -> `step_`); packing reads the unescaped key.

export const GLSL_BINDING = /^_group_(\d+)_binding_(\d+)_[vf]s/;

const uniform_path = (name) => {
  const local = name.replace(GLSL_BINDING, "").replace(/\[0\]$/, "");
  return [...local.matchAll(/\[(\d+)\]|(\w+)/g)].map(([, index, key]) =>
    index === undefined ? key : Number(index),
  );
};

const uniform_shapes = (gl) =>
  new Map([
    [gl.FLOAT, ["f32", 1, 1]],
    [gl.FLOAT_VEC2, ["f32", 2, 1]],
    [gl.FLOAT_VEC3, ["f32", 3, 1]],
    [gl.FLOAT_VEC4, ["f32", 4, 1]],
    [gl.INT, ["i32", 1, 1]],
    [gl.INT_VEC2, ["i32", 2, 1]],
    [gl.INT_VEC3, ["i32", 3, 1]],
    [gl.INT_VEC4, ["i32", 4, 1]],
    [gl.UNSIGNED_INT, ["u32", 1, 1]],
    [gl.UNSIGNED_INT_VEC2, ["u32", 2, 1]],
    [gl.UNSIGNED_INT_VEC3, ["u32", 3, 1]],
    [gl.UNSIGNED_INT_VEC4, ["u32", 4, 1]],
    [gl.FLOAT_MAT2, ["f32", 2, 2]],
    [gl.FLOAT_MAT3, ["f32", 3, 3]],
    [gl.FLOAT_MAT4, ["f32", 4, 4]],
  ]);

export const block_layout = (gl, program, block, label) => {
  const members = [
    ...gl.getActiveUniformBlockParameter(
      program,
      block,
      gl.UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES,
    ),
  ];
  const read = (pname) => gl.getActiveUniforms(program, members, pname);
  const types = read(gl.UNIFORM_TYPE);
  const counts = read(gl.UNIFORM_SIZE);
  const offsets = read(gl.UNIFORM_OFFSET);
  const array_strides = read(gl.UNIFORM_ARRAY_STRIDE);
  const matrix_strides = read(gl.UNIFORM_MATRIX_STRIDE);
  const shapes = uniform_shapes(gl);
  const fields = members.map((member, index) => {
    const name = gl.getActiveUniform(program, member).name;
    const shape = shapes.get(types[index]);
    if (!shape) throw new Error(`${label}: cannot pack uniform "${name}".`);
    const [kind, rows, columns] = shape;
    return {
      path: uniform_path(name),
      is_array: name.endsWith("[0]"),
      count: counts[index],
      offset: offsets[index],
      array_stride: array_strides[index],
      matrix_stride: matrix_strides[index],
      kind,
      rows,
      columns,
    };
  });
  return {
    first_member: gl.getActiveUniform(program, members[0]).name,
    bytes: gl.getActiveUniformBlockParameter(
      program,
      block,
      gl.UNIFORM_BLOCK_DATA_SIZE,
    ),
    fields,
  };
};

const read_path = (root, path) => {
  let value = root;
  for (const key of path) {
    if (value === null || typeof value !== "object") return undefined;
    const escaped = typeof key === "string" && !(key in value);
    value = escaped && key.endsWith("_") ? value[key.slice(0, -1)] : value[key];
  }
  return value;
};

const write_value = (view, offset, field, value) => {
  if (value === undefined) return;
  const base = offset / 4;
  if (typeof value !== "object") {
    view[base] = Number(value);
    return;
  }
  for (let column = 0; column < field.columns; column += 1) {
    for (let row = 0; row < field.rows; row += 1) {
      view[base + (column * field.matrix_stride) / 4 + row] =
        value[column * field.rows + row] ?? 0;
    }
  }
};

const pack = (layout, value, views) => {
  views.u32.fill(0);
  if (value === undefined) return;
  for (const field of layout.fields) {
    const found = read_path(value, field.path);
    if (found === undefined) continue;
    for (let index = 0; index < field.count; index += 1) {
      const element = field.is_array ? found[index] : found;
      const offset = field.offset + index * field.array_stride;
      write_value(views[field.kind], offset, field, element);
    }
  }
};

const create_uniform_buffer = (gl, layout) => {
  const bytes = new ArrayBuffer(layout.bytes);
  const handle = gl.createBuffer();
  gl.bindBuffer(gl.UNIFORM_BUFFER, handle);
  gl.bufferData(gl.UNIFORM_BUFFER, layout.bytes, gl.DYNAMIC_DRAW);
  return {
    handle,
    bytes,
    views: {
      f32: new Float32Array(bytes),
      i32: new Int32Array(bytes),
      u32: new Uint32Array(bytes),
    },
  };
};

// ponytail: uniform buffers live until gpu.dispose(); upgrade when an effect
// rebuilds draws often enough (lettering prepare) to show in GPU memory.
export const bind_block = (state, block) => {
  const { gl } = state.gpu;
  let buffer = state.buffers.get(block.name);
  const fresh = !buffer;
  if (fresh) {
    buffer = create_uniform_buffer(gl, block.layout);
    state.buffers.set(block.name, buffer);
  }
  if (fresh || state.dirty) {
    pack(block.layout, state.bag[block.name], buffer.views);
    gl.bindBuffer(gl.UNIFORM_BUFFER, buffer.handle);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, buffer.bytes);
  }
  gl.bindBufferBase(gl.UNIFORM_BUFFER, block.point, buffer.handle);
};
