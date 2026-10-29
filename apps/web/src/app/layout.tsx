import type { Metadata } from "next";
import { Sora, Space_Mono } from "next/font/google";
import "./globals.css";

const sora = Sora({ variable: "--font-sora", subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], display: "swap" });
const mono = Space_Mono({ variable: "--font-space-mono", subsets: ["latin"], weight: ["400", "700"], display: "swap" });

export const metadata: Metadata = {
  title: "Effi Connect · Grupo RZ",
  description: "Guías, estados, novedades y dinero de Effi en vivo.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${sora.variable} ${mono.variable} h-full antialiased`}>
      <body className="glow-bg min-h-full">{children}</body>
    </html>
  );
}
