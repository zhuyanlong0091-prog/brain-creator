import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Brain Creator",
  description: "Engineering console for page modeling and test evidence"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
