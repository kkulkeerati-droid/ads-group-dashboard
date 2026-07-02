import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ads Group Dashboard",
  description: "ค่าโฆษณาแบ่งตามกลุ่มชื่อ ads — Meta + TikTok",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
