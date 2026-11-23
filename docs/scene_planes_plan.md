# Scene planes: one loop, one budget, and GPU planes in the compositor

Status: plan, 2026-11-23. Nothing in this plan is built yet.
Sol makes the decisions.
Kintsu wrote the plan after the writing sky work in solarisael `e73b628`.

## Why

Each GPU effect of solarisael.com opens its own device.
Each effect also runs its own animation loop.
On `/writing/`, the star map, the text effects, the mantle glows and the side menu each call `requestAnimationFrame`.
Nothing coordinates these loops.
The Folly frame budget sees only the text effects.
The star map uses as much of the frame as it needs and leaves no time for other effects.

The star map shows the cost.
Its nebula was one shader that did all the work: the lens, the cluster light, the rings, the seals, the dust noise, the disk gas, the far stars and the final mix.
On an Android phone at 120 Hz, the map fell to 48–65 fps on WebGPU while a finger moved.
On WebGL2 it fell to 54–57 fps.
A change moved only the dust into its own pass at half resolution.
After that change, the map showed 77–84 fps on WebGPU and 71–74 fps on WebGL2.

Each part of an effect must have its own resolution and its own rate.
A modular structure is the only structure that scales past one effect.

Folly already has most of the parts:

- `scene/compositor.js` composes ordered planes on one output canvas.
  It works on WebGPU and WebGL2 from one WGSL source, in a pixel budget.
- `gpu/frame_loop.js` is an explicit state machine for frames: `idle | waiting | queued | drawing`.
- `gpu/budget.js` lowers an effect when the effect costs more than its share.
  The levels are: scale 1, scale 0.75, scale 0.5, half rate, quarter rate, and a still image.
- `gpu/lifecycle.js` controls device loss: `idle | booting | ready | recovering | failed | dead`.
  It tries WebGL2 one time after a loss.

These parts serve different callers today.
The compositor has no loop, and it accepts only images.
The loop and the budget serve only text captures and panel captures.
The lifecycle serves only the text runtime.

This plan makes them one system.
Each GPU effect can join that system.

## What Folly gets

### 1. GPU planes in the compositor

Today a plane is an image.
The compositor uploads the image when the caller calls `input.update()`.

A GPU plane is different.
The caller draws it with its own passes on the device of the compositor.
The caller draws it each time it is due, and nothing is uploaded.

```js
const sky = await scene.compose(canvas, { budget: "page" });
const dust = sky.field(dust_layer, {
  build: (gpu, api) => /* targets, effects */,
  draw: (frame, { size, level, now }) => /* passes into its own target */,
  scale: 0.5,          // of the composition; the budget can lower it
  format: "rgba16float",
});
const nebula = sky.plane(nebula_layer, {
  build, draw,         // draws directly into the composition
  reads: [dust],       // its draw gets the texture of the dust field
  blend: "replace",
});
const stars = sky.plane(stars_layer, { build, draw, blend: "add" });
```

- A **field** draws into its own target at its own scale.
  Other planes read the field.
  The compositor does not show a field by itself.
- A **plane** draws into the composition with a blend mode: `replace`, `over` or `add`.
  `over` is premultiplied source-over, the only mode today.
- A plane that does not read the composition below it needs no ping-pong pass.
  Thus an `add` plane, for example the stars, costs only its draws.
- Image inputs and backdrop treatments do not change.
  They still use ping-pong passes, because they read the composition below them.
- After a device loss, the compositor calls `build(gpu, api)` again on the new device.
  A plane keeps no GPU resource across a device loss.

### 2. One loop and one budget for the page

One loop for the page draws each composition and the text runtime.
The loop draws all of them in one animation frame.
Each composition submits its work to the GPU one time for each frame.
The `frame_loop.js` of the text runtime becomes this loop, and its states do not change.

Each plane and each field declares:

- `share`: its part of the frame, as for the text effects today.
- `wants_frame(now)`: true while it moves.
  For the map, this is true during a flight or a gesture, and at the ambient rate at other times.
- `levels`: the levels it accepts, scale or rate or both.
  A field usually accepts scale.
  A plane of stars usually accepts neither.

The budget decides for each item, as it does for text today.
It lowers the scale first, then the rate, and then it shows a still image.
In the map, `DUST_SCALE = 2` becomes the first level of the dust field.
It stops being a constant.

### 3. Cost measurement without trust in timestamp-query

The budget measures GPU time with `timestamp-query`.
On one Android phone, with WebGPU enabled by browser flags, these timestamps are wrong.
They show 25 ms for the nebula pass.
At the same time, the page draws that pass in each frame and keeps 60 fps.
A budget that trusts these numbers lowers effects for no reason.

The loop uses three methods, in this order:

1. **Checked timestamps.**
   The loop uses `timestamp-query` only while the sum of the pass times stays below the frame gap at display rate.
   If the timestamps show more time than the frames take, the loop stops its trust in them for the session.
2. **Fences on WebGL2.**
   The loop sets a `fenceSync` after a submission, and polls it between tasks.
   On the same phone, this method gave stable numbers: 13–17 ms for the whole sky on WebGL2.
3. **Frame gaps.**
   If no other method is available, the loop lowers the most expensive share while frames miss the display rate.
   It raises that share again after `STEP_UP_MS` with time to spare.

### 4. One lifecycle for each GPU effect

`gpu/lifecycle.js` becomes the lifecycle of the page.
The page has one device.
Each composition and the text runtime use that device.
When the device is lost, the lifecycle calls `on_release` on each item.
Then it tries WebGL2 one time and calls `build` again for each item.
If no backend works, each effect shows its native fallback.
Text shows as text, and the map shows its stars as plain points.

### 5. A lint, and Striatum rules that prove their work

Folly gets a lint with rules and rule tests.
CI runs the lint next to `glsl:check`.

- `ast-grep` rules for JavaScript.
  Each rule has `valid` and `invalid` cases, and `sg test` runs them.
- A WGSL check in `scripts/` for the shader rules that ast-grep cannot parse.

The first rules come from this plan:

- A pure shader module declares no `@group` or `@binding` and no `var<uniform>`.
  Only entry shaders declare bindings.
- The `draw` of a plane does not call `requestAnimationFrame`, does not open a device, and does not change the DOM.
- A GPU effect does not call `requestAnimationFrame` and does not open a backend outside the loop and the lifecycle.

Some rules also guide agents.
Each of these rules becomes a House coding lesson.
The `astCondition` of the lesson uses the same pattern as the rule, or a regex for WGSL.
Then Striatum warns while an agent writes code, and CI stops what gets past.
A test runs the pattern of each lesson against the `invalid` cases of its rule.
If a lesson stops firing, the build fails.

## What the star map keeps

The map stays in solarisael.
It keeps these parts:

- The model, the labels, the card, the finder and the list.
- Its shaders.
  The nebula is already split into pure pieces: `sight`, `clusters`, `disk`, `far_stars`, `dust_noise` and `compose`.
  Two entry shaders, `nebula` and `dust`, read the bindings.
- **Its camera, input and selection, as an explicit state machine.**
  - A pure function, `step(state, event) → { state, effects }`, makes each change.
  - Events: `pointer_down`, `pointer_move`, `pointer_up`, `wheel`, `key`, `resize`, `choose`, `show_cluster`, `frame(now)`, `motion_changed`, `visibility_changed`, `menu_opened`, `menu_closed`, `disposed`.
  - Camera states: `resting | flying(flight | wheel) | gesturing`.
  - The edge changes DOM events into events.
    It also does the effects: it marks planes as out of date, places the labels, shows the card, makes announcements, and writes the history snapshot.
  - Tests cover valid sequences and invalid sequences.
    Examples: an event after `disposed`, a gesture during a flight, and the menu that opens during a flight.

The map gives these parts to Folly: `frame_scheduler.js` and `frame_gate.js` for the sky, its own device in `gpu.js`, `lose_sky`, and `DUST_SCALE`.

The map as planes:

| item   | kind  | reads | blend   | levels      |
| ------ | ----- | ----- | ------- | ----------- |
| dust   | field | —     | —       | scale, rate |
| nebula | plane | dust  | replace | scale       |
| rings  | plane | —     | add     | —           |
| stars  | plane | —     | add     | —           |

Later, the far stars and the disk gas can leave the nebula as planes of their own.
First, the loop must show their cost.

## Order of work

1. The Folly lint and the first rules, with rule tests and CI.
   This step is small, and it protects each step after it.
2. GPU planes, fields and blend modes in the compositor, with tests on both backends.
3. The page loop and the lifecycle.
   `frame_loop.js` and `lifecycle.js` serve compositions as well as text.
   The text runtime moves onto them, and its behaviour does not change.
4. Measurement: checked timestamps, fences and frame gaps.
5. The map moves onto one composition.
   Proof: captures with reduced motion are byte-identical to the current build on both backends.
   Then an A/B test on a phone at 120 Hz while a finger moves.
6. The camera and input state machine of the map.
7. The other effects of the site (fog, mantle glow, obsidian, menu), each one when work touches it.

Before step 2, Sol decides about two WebGL2 commits for texture arrays in the `folly-arrays` checkout: `bb9b026` and `ebaab69`.
He can land them or drop them.
This plan does not need them.

## Open questions

- One device for each page means that all effects share one WebGL2 context on the fallback backend.
  The state of the context must be reset between items.
  The WebGL2 backend already binds its state for each draw.
  A test must show text, fog and the map on one page.
- Does the atlas pass of the text runtime become a plane of its own composition, or does it stay a separate client of the loop?
- Does `scene.compose` keep its name when it holds planes that are not images?
