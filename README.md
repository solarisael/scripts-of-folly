# Scripts of Folly

Collection of text and overlay effects for digital books and novels.

The Drown shader uses white water with light text and black water with dark text.
This default follows the page ink for dark and light themes.
Explicit effect colors keep their colored water and pale blue highlights.

GPU effects use one shared GPU surface sized for the largest visible effect.
Each effect renders separately into this surface.
The runtime copies each result to a small canvas inside its target.
These canvases follow document scrolling, nested scrolling, fixed elements, and sticky elements between shader frames.
DOM ancestors apply clipping to the canvases.

The effect FPS setting limits rendering and canvas copies, including during scrolling.
Copies use `drawImage` without CPU pixel readback.
Copy cost increases with the visible effect area.
The runtime removes each canvas when its effect ends.
Reduced motion uses a settled frame.

Each GPU effect has one shader, written in WGSL.
On WebGPU, vgpu runs the WGSL.
vgpu 0.6 takes only prepared shaders (ShaderSource v2).
`prepareShader()` from `@vgpu/wgsl/prepare` prepares each shader at build time, so a page never loads the WGSL parser.
Without WebGPU, the WebGL2 leg in `src/webgl2/` runs the same shader.
Naga converts the WGSL to GLSL for this leg.

After a change to a shader, run `bun run glsl:build` and commit the `wgsl.generated.js` and `glsl.generated.js` files.
This needs naga-cli 30.0.1 on PATH: `cargo install naga-cli --version 30.0.1`.
`bun run glsl:check` fails when a generated file does not match its WGSL.
After a change to `src/terminal/terminal.wgsl`, run `bun run build:terminal-shader`; `bun run check:terminal-shader` fails when `terminal_shader.js` does not match.
Both terminal scripts validate the shader on a WebGPU device.

The WebGL2 leg mirrors the part of the vgpu API that Folly and its host pages use.
Import it from `scripts-of-folly/webgl2`.
Pair each prepared shader (a `.wgsl` import through the vgpu loader) with its GLSL through `shader_module()`.
It returns the shader itself and keeps the GLSL for the WebGL2 leg.
A host page can pass `open_gpu(kind)` to `install_gpu_effects()`.
Then the text effects open their GPU through the page's own backend selection.

The text effect CSS sets layout and fonts only.
The GPU draws all colour, glow, shadow, and motion.
Without a GPU, the text shows as plain text.
The runtime sends `folly:gpu-settled` on the document when all the effects are prepared.
A host page can show its text effects after this event.

The text effects share half of each frame on the GPU.
Each effect gets a part of that time in proportion to its share.
An effect over its part steps down: a lower render scale, then a lower frame rate, then a still.
The cost comes from GPU timestamps, so it needs WebGPU with the `timestamp-query` feature.
Without timestamps, every effect stays at full quality.
`install_gpu_effects()` returns `budget`.
`budget.report()` gives the level, measured cost, and part of each visible effect.
`budget.tune({ frame_share, shares })` changes the numbers while the page runs.

## Checks for a change to the GPU text runtime

Run `bun run test` for the unit tests.

Run `bun run gpu:compare --before <revision>` to compare this tree with an earlier commit in a real browser.
The script builds one test page from each tree.
It does the same steps on each page: text changes, style changes, new and removed effects, a lost GPU, `refresh()`, and `dispose()`.
After each step it compares the state and the picture of each effect.

Give the script a browser.
`--executable <path>` starts a Chromium browser with software WebGL2.
`--browser <url>` uses a browser that already runs, for example one with WebGPU on another machine.
That browser must load the page from its own `127.0.0.1`, so forward port 4399 to it.

`--stale <rounds>` counts the captures that are out of date after a late style change.
`--bench <rounds>` gives the time of a full recapture and the longest gap between two frames.
The head of `scripts/gpu_compare.js` lists all options.

## Page transitions

Import page transitions from `scripts-of-folly/transitions`.
A transition grows one ring of ink from the clicked link, and the new page shows inside the ring.

```js
const transition = create_page_transition({ mode: () => "ink" });
await transition.run(() => apply_new_state(), { origin: [0.5, 0.35] });
bind_htmx_navigation(htmx, transition, { target: "#page" });
```

The mode can be `ink`, `fade`, or `off`.
The `ink` mode uses the View Transitions API.
The browser keeps a picture of the old page, and the ring clips the live new page over it.
The ring is a band of ink, and the clip line of the new page runs through its middle.
The ring takes `ring_ms` (1600 ms by default).
`ring_width(view_width, view_height)` gives half the band in CSS pixels.
The `fade` mode cross-fades the two pages in `fade_ms` (600 ms by default).
Reduced motion, and a browser without View Transitions, always use `off`.

A host can draw the band with its own look.
Pass `open_painter(canvas)`, which resolves to `{ draw(frame), dispose() }`.
The frame holds `x`, `y`, `radius`, `width`, `progress`, `seconds`, `view_width`, and `view_height`, in CSS pixels.
`draw` must cover the line with opaque ink and stay within `width * 2` of the line.
`warm()` opens the painter before the first transition.
A transition never waits for the painter.
Until the painter is open, and after it fails, the ring is a soft band on a 2D canvas.
The 2D band uses the text colour of `document.body` by default.
Pass `colors: () => colors_of(element)` to use the element that holds the reading text.
`folly:transition-started` tells which surface drew the ring: `detail.painter` is `host` or `soft`.

`bind_htmx_navigation()` sends each request for the target at once.
When the response arrives, it removes the swap and settle delays and asks htmx to swap inside a view transition.
The ring starts at the centre of the clicked link.
Preload requests do not start a transition.
A failed request, or a response without a swap, does not start a transition.
The page stays clickable during the ring.
A new navigation skips the running transition.
Back and forward also play the ring when htmx restores the target from its history.
The ring starts at the left edge for back and at the right edge for forward.
Without the Navigation API, it starts at the centre.
The binding sends `htmx:historyRestore` again after the swap, so its listeners see the restored page.
The transition sends `folly:transition-started` and `folly:transition-finished` on the document.
A host can give a fixed element its own `view-transition-name` to keep it above the ring.

The Pretext sentence transitions are at `scripts-of-folly/pretext/transitions`.
The `effect` option is `dust`, `fog`, or `crumble`.
`crumble` breaks the text into small squares of its ink.
Set `travel: [x, y]` in CSS pixels to make the crumbs flow that distance in that direction.
Without `travel`, each crumb drifts in its own direction until it is gone.
Set `well: [x, y]` to make the crumbs fall into one point.
The point is in CSS pixels from the top left of the root.
The nearest crumbs fall first, each crumb starts slowly, and it is gone at the well.
`well` has priority over `travel`.
The crumbs do not go out of an ancestor that clips its overflow.
A transition never waits for its shader.
Until the shader is open, a transition plays a native animation and opens the shader for the next one.
Call `warm_pretext_transitions()` to open the shader before the first transition.
A host with its own GPU seam passes it as `open_gpu` to `warm_pretext_transitions()` and `transition_pretext_content()`.
One shader transition plays at a time in a document; a second one plays the native animation.
