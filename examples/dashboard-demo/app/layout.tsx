import type { Metadata } from "next";
import type { ReactNode } from "react";
import { OverlayMount } from "../components/OverlayMount";
import "./globals.css";

export const metadata: Metadata = {
  title: "Revenue — Acme Analytics",
  description: "GroundTrace reference demo",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <OverlayMount />
      </body>
    </html>
  );
}
