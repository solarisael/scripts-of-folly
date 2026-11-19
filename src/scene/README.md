# Scene layers

Import `scene_for` from `scripts-of-folly/scene`.
The utility uses the DOM as its scene graph.
It creates no canvas, GPU device, or animation loop.

Use one scene for each document.
Register a content layer with `scene.layer(element)`.
Register an independent output with `scene.layer(canvas, { surface: true })`.
A surface contains rendered output, not source text for another effect.

```js
const scene = scene_for(document);
const manuscript = scene.layer(article);
const water = manuscript.add(canvas, { surface: true });
water.own(() => renderer.dispose());
water.set_order(2);
water.set_opacity(0.5);
```

## Composition and ownership

Use `set_order`, `set_transform`, and `set_opacity` to change composition.
These methods preserve the DOM nodes and owned resources.
Order uses native CSS stacking rules.
Position sibling planes, or place them in a flex or grid container.
An order number does not declare a dependency.

Use `add` to register and append a child layer.
The `parent` property follows the registered DOM ancestor.
Reparenting content retains its resources and permits capture invalidation.
New ancestors can change inherited fonts, colors, and layout.

Register resource cleanup with `own(dispose)`.
Call `dispose()` before you remove a layer.
Disposal releases registered descendants and resources once.
Disposal does not remove the DOM nodes.
All resources receive cleanup even when one callback fails.
An `AggregateError` reports cleanup failures.
A disposed layer rejects further changes.

## Invalidation

The Folly GPU runtime uses this utility automatically.
Composition changes on a registered layer do not invalidate text captures.
Style changes that also change fonts or geometry still invalidate captures.
Transforms inside a captured paragraph remain content changes unless that element owns a separate layer.

Registered output surfaces do not trigger capture invalidation for their styles, dimensions, or insertion.
Mixed insertions with source content remain visible to the runtime.
Removal records retain output ownership until the observer processes them.
A reused connected element needs a new registration.

Content changes affect captures in the owning layer and captures that contain that layer.
Unregistered changes retain conservative invalidation.
Global font, theme, and viewport changes remain valid dependencies.

The utility reads styles and ownership only.
It never reads text, captures private content, or changes authorization.

## Composed rendering

Use `await scene.compose(outputCanvas, options)` to create a GPU compositor.
You can also import `create_compositor` from `scripts-of-folly/scene/compositor`.
The options accept `backend`, `open_gpu`, and `max_pixels`.
The default pixel budget is 1,048,576 pixels.
The compositor tries WebGPU first and then WebGL2 when device initialization fails.
An explicit backend selects one implementation.
Both implementations use the same WGSL source.

Register each image with `compositor.source(layer, image, { rect })`.
Inputs accept browser image sources that the backend can upload.
An existing effect canvas can supply a rendered text block.
The compositor never captures arbitrary DOM.
Do not supply inaccessible or unauthorized content.
Source images remain owned by the caller.

Rectangles use `[x, y, width, height]` in output CSS pixels.
The default source rectangle starts at zero and uses the image dimensions.
Call `input.set_rect(rect)` to move or resize a plane.
Call `layer.set_order(number)` to change its composition order.
Equal order values retain input registration order.
Call `layer.set_opacity(number)` to change its opacity.
Composition uses these explicit values.
It does not infer DOM transforms, ancestor opacity, or CSS stacking contexts.

```js
const compositor = await scene.compose(canvas);
const backgroundInput = compositor.source(backgroundLayer, backgroundImage);
const textInput = compositor.source(textLayer, textEffectCanvas);
const blurInput = compositor.backdrop(blurLayer, {
  rect: [20, 20, 400, 160],
  radius: 12,
});
backgroundLayer.set_order(0);
blurLayer.set_order(1);
textLayer.set_order(2);
await compositor.render({ width: 640, height: 320, pixel_ratio: 1 });
```

The backdrop plane samples the composition below its order.
Its rectangle limits the final blur result.
Higher layers remain sharp.
Move the blur above a text layer to blur that text.
Multiple blur planes each sample the composition available at their position.
The radius accepts values from zero to 64 CSS pixels.
The shader uses two separable passes with nine samples per pass.
Three reusable targets prevent read-write feedback and retain the original image outside the blur region.
Composition uses premultiplied source-over alpha.

Call `input.update()` after a source canvas changes.
Call `input.update(newImage)` to replace its image.
Only explicit image updates upload source pixels.
Order, opacity, rectangle, and blur changes reuse uploaded images.
Render calls with unchanged inputs and dimensions submit no frame.
The `stats` property reports frames, source uploads, and render passes.
It does not report presented frames or GPU execution time.

The caller schedules rendering.
The compositor creates no animation loop.
Concurrent render calls fail instead of accumulating work.
The pixel budget limits the physical target dimensions.
The caller handles initialization, device loss, and rendering errors.
Keep accessible source content available when rendering fails.

Call `input.dispose()` to remove an input and release its uploaded image.
Layer disposal removes its registered inputs.
Call `compositor.dispose()` to release targets, source textures, and the GPU device.
Output layer disposal also releases the compositor.
Native effect pipelines remain owned by the device until compositor disposal.
Disposal does not remove or hide the source DOM.

## Backdrop treatments

Set `effect` to `blur`, `refraction`, or `chroma` when you create a backdrop input.
Call `input.set_effect(name)` to change its treatment.
The input retains its uploaded sources and compiled effects.
The `radius` value controls blur reach, refraction displacement, or chromatic separation in CSS pixels.
Zero strength leaves the composition unchanged.
Refraction and chromatic separation each use one shader pass.
They preserve pixels outside the plane rectangle.
The plane order determines which underlying layers receive the treatment.

## Neon masks and layer stacks

Set `source_effect: "neon"` on a source input to render a baked neon mask.
The RGB channels contain the core, small glow, and wide glow masks.
The source alpha must be opaque so browser uploads preserve the mask channels.
The shader creates a mint halo and a white-hot core with premultiplied alpha.
Call `input.set_source_effect("image")` to restore ordinary image composition.
Styling changes preserve the uploaded source image.

Use `scene.stack(layers)` with a front-to-back list of registered layers.
The stack assigns explicit composition order values.
Call `stack.move(layer, offset)` to change its position.
Negative offsets move toward the front.
Moves beyond either boundary return false.
The stack rejects duplicate, disposed, and foreign-document layers.
It preserves layer resources.
Layers outside the stack retain their order.

Import `create_render_queue` from `scripts-of-folly/scene` to serialize asynchronous rendering.
Pass the draw function and the `report` and `on_error` callbacks.
Repeated requests coalesce and consume current state.
Call the returned function with false to suppress a diagnostic report.
Call its `dispose()` method to stop queued work and reports.
An in-flight draw finishes before the queue stops.
Rendering failures reach `on_error` and stop the queue.

## Authoring text stacks

Import `create_text_stack` and `TEXT_STACK_EFFECTS` from `scripts-of-folly/text/stack`.
This utility owns text effect choices, settings, order, and compatibility rules.
It uses the existing text contract and canonical HTML renderer.
It is separate from scene backdrop planes.

Use `add(name)`, `remove(name)`, and `move(name, offset)` to edit the stack.
Negative offsets move an effect earlier in the listed order.
Use `set(name, channel, value)` for `intensity`, `motion`, `speed`, and supported `color` values.
Numeric values use the existing 0.2–5 authoring range.
Colors accept a six-digit hex value or null.
Null restores the inherited color.
The metadata identifies which controls affect each treatment.
Fixed typography treatments have no numeric knobs.

The utility rejects duplicates and the existing incompatible pairs.
Rejected changes preserve the previous stack.
The `effects` property exposes immutable state.
Call `html(text)` to render the current stack through Folly's existing span builder.
The renderer escapes source text.
An empty stack emits ordinary text.
The utility creates no DOM observer or animation loop.
