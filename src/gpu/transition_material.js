import * as THREE from "three/webgpu";
import * as tsl from "three/tsl";

const hash = (point) =>
  tsl.fract(tsl.sin(tsl.dot(point, tsl.vec2(127.1, 311.7))).mul(43758.5453));

const noise = (point) => {
  const cell = tsl.floor(point);
  const local = tsl.fract(point);
  const weight = local.mul(local).mul(tsl.float(3).sub(local.mul(2)));

  return tsl.mix(
    tsl.mix(hash(cell), hash(cell.add(tsl.vec2(1, 0))), weight.x),
    tsl.mix(hash(cell.add(tsl.vec2(0, 1))), hash(cell.add(1)), weight.x),
    weight.y,
  );
};

export function create_transition_material(texture, captured) {
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;

  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  const transition = tsl.uniform(new THREE.Vector4(1, 0, 0, 0));
  const size = tsl.uniform(new THREE.Vector2(captured.width, captured.height));
  const source = tsl.texture(texture);

  const sample = (coordinate) => {
    const inside = tsl
      .step(tsl.vec2(0), coordinate)
      .mul(tsl.step(coordinate, tsl.vec2(1)));
    return source
      .sample(tsl.vec2(coordinate.x, tsl.float(1).sub(coordinate.y)))
      .mul(inside.x.mul(inside.y));
  };

  material.fragmentNode = tsl.Fn(() => {
    const uv = tsl.vec2(tsl.uv().x, tsl.float(1).sub(tsl.uv().y));
    const progress = tsl.clamp(transition.y, 0, 1);

    const output = tsl.vec4(0).toVar();
    tsl
      .If(progress.lessThanEqual(0), () => {
        output.assign(sample(uv));
      })
      .ElseIf(progress.lessThan(1), () => {
        const pixel = uv.mul(size);
        const seed = tsl.vec2(transition.z.mul(17), transition.z.mul(31));

        tsl
          .If(transition.x.lessThan(1.5), () => {
            const grain = tsl.floor(pixel.div(3)).add(seed);
            const grain_noise = hash(grain);
            const drift = tsl
              .vec2(
                hash(grain.add(tsl.vec2(7, 3)))
                  .sub(0.5)
                  .mul(28),
                grain_noise.add(0.3).mul(-24),
              )
              .mul(progress.mul(progress));
            const ink = sample(uv.sub(drift.div(size)));
            const remaining = tsl
              .float(1)
              .sub(
                tsl.smoothstep(
                  grain_noise.mul(0.65).add(0.1),
                  grain_noise.mul(0.65).add(0.35),
                  progress,
                ),
              );

            output.assign(tsl.vec4(ink.rgb, ink.a.mul(remaining)));
          })
          .Else(() => {
            const cloud = noise(
              pixel
                .div(24)
                .add(seed)
                .add(tsl.vec2(progress.mul(1.4), progress.negate())),
            );
            const detail = noise(pixel.div(9).add(seed));
            const density = cloud.mul(0.7).add(detail.mul(0.3));
            const drift = tsl
              .vec2(
                tsl
                  .sin(pixel.y.div(18).add(seed.x).add(progress.mul(4)))
                  .mul(7),
                cloud.mul(-8).sub(10),
              )
              .mul(progress);
            const coordinate = uv.sub(drift.div(size));
            const radius = tsl.vec2(progress.mul(6)).div(size);
            const ink = tsl.vec4(0).toVar();

            for (let y = -1; y <= 1; y += 1) {
              for (let x = -1; x <= 1; x += 1) {
                const tap = sample(coordinate.add(tsl.vec2(x, y).mul(radius)));
                ink.addAssign(tsl.vec4(tap.rgb.mul(tap.a), tap.a));
              }
            }

            const remaining = tsl
              .float(1)
              .sub(
                tsl.smoothstep(
                  density.mul(0.45).add(0.15),
                  density.mul(0.45).add(0.55),
                  progress,
                ),
              );

            output.assign(
              tsl.vec4(
                ink.rgb.div(tsl.max(ink.a, 0.00001)),
                ink.a.div(9).mul(remaining),
              ),
            );
          });
      });

    return output;
  })();

  return {
    material,
    transition,
    time: tsl.uniform(0),
    dispose() {
      material.dispose();
    },
  };
}
