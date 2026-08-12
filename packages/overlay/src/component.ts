/**
 * Resolving a clicked DOM node back to the component that rendered it.
 *
 * This is the one place BUILD_SPEC §3 earmarks `bippy` for: `data-truth-id`
 * alone is ambiguous when the same id is rendered inside a list, and React
 * doesn't expose its fiber tree publicly. bippy reads it off the DevTools hook
 * across React 17–19, which is a solved problem not worth re-solving.
 *
 * Strictly an enhancement. If React isn't there, or the hook was installed too
 * late, the overlay falls back to the call site the SDK captured at render time.
 */
import { getDisplayName, getFiberFromHostInstance, isCompositeFiber } from "bippy";

export function resolveComponentName(element: Element): string | undefined {
  try {
    let fiber = getFiberFromHostInstance(element);
    // Walk up to the nearest composite (function/class) fiber — the host fiber
    // for a <span> is the span itself, which tells us nothing useful.
    while (fiber != null && !isCompositeFiber(fiber)) {
      fiber = fiber.return ?? null;
    }
    if (fiber == null) return undefined;
    const name = getDisplayName(fiber);
    return name === null || name === undefined || name === "" ? undefined : name;
  } catch {
    return undefined;
  }
}
