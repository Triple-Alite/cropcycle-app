import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CropCycle | Grow smarter, season after season",
  description: "Bring soil data, farm history and trusted agricultural knowledge together for every growing season.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
