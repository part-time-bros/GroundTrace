# @groundtrace/overlay

The browser overlay for [GroundTrace](https://github.com/part-time-bros/groundtrace). Click
any `[data-truth-id]` element and see its provenance tree.

```ts
import { mountOverlay } from "@groundtrace/overlay";

useEffect(() => mountOverlay().destroy, []);
```

`groundtrace run` injects the prebuilt `dist/overlay.global.js` into any app instead, so no
code change is needed there.

The panel lives in a shadow root, so it neither inherits the host app's CSS nor leaks its
own. Monospace, box-drawing connectors, greyscale — the five classification colours are the
only colour in the UI. <kbd>Esc</kbd> closes it and returns focus to the value that opened
it. It says **DEV MODE — not for production** on screen, because it is.

MIT
