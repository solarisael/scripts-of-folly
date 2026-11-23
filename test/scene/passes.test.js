import { expect, test } from "bun:test";
import { composition_plan, field_textures, scaled_size } from "../../src/scene/passes.js";

const entry = (kind, order, options) => ({ input: { kind, ...options }, order });

test("only an image or backdrop splits visible draws; fields precede all groups", () => {
  const field = entry("field", 100);
  const replace = entry("plane", -2, { blend: "replace", reads: [field.input] });
  const image = entry("source", 1);
  const add = entry("plane", 1, { blend: "add" });
  const over = entry("plane", 1, { blend: "over" });
  const blur = entry("backdrop", 5);
  const layers = [blur, image, field, add, over, replace];
  const { fields, groups } = composition_plan(layers, new Map());
  expect(fields).toEqual([field]);
  expect(groups).toEqual([
    { base: null, planes: [replace] },
    { base: image, planes: [add, over] },
    { base: blur, planes: [] },
  ]);
});

test("a plane resolves the current attachment in reads order, never a retired field", () => {
  const a = {}, b = {};
  const target = { color: "before resize" };
  const prepared = new Map([[a, { target }], [b, { target: { color: "b" } }]]);
  const reads = [b, a];
  expect(field_textures(reads, prepared)).toEqual(["b", "before resize"]);
  target.color = "after resize";
  expect(field_textures(reads, prepared)).toEqual(["b", "after resize"]);
  prepared.delete(a);
  expect(() => field_textures(reads, prepared)).toThrow("no longer live");
});

test("a new device needs every build even when layer identities and order survive", () => {
  const field = entry("field", 1), plane = entry("plane", 2), late = entry("plane", 3);
  const layers = [field, plane, late];
  const prepared = new Map([[field.input, {}], [plane.input, {}]]);
  expect(composition_plan(layers, prepared).build).toEqual([late.input]);
  expect(composition_plan(layers, new Map()).build).toEqual([field.input, plane.input, late.input]);
});

test("a thin field retains a texel, but its scale cannot exceed either target limit", () => {
  expect(scaled_size(1, 7, 0.5, 16, 4)).toEqual([1, 3]);
  expect(() => scaled_size(3, 3, 2, 32, 8)).toThrow(RangeError);
  expect(() => scaled_size(1, 5, 2, 32, 8)).toThrow(RangeError);
});
