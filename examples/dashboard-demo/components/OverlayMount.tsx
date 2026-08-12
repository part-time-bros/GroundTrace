"use client";

/**
 * Mounts the GroundTrace overlay in the demo.
 *
 * `groundtrace run` injects the prebuilt IIFE into arbitrary apps instead; the
 * demo imports the module directly so that `pnpm dev` alone is enough, with no
 * second process to start.
 */
import { useEffect } from "react";
import { mountOverlay } from "@groundtrace/overlay";

export function OverlayMount() {
  useEffect(() => {
    const overlay = mountOverlay();
    return () => {
      overlay.destroy();
    };
  }, []);

  return null;
}
