import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Footer, Header } from "../components/site";

export const metadata: Metadata = {
  title: "OpenFrontDesk: tu front desk autónomo",
  description:
    "Un front desk de código abierto que atiende, cobra y vende por voz y WhatsApp, bajo las políticas que vos controlás.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-AR">
      <body className="min-h-screen">
        <Header />
        {children}
        <Footer />
      </body>
    </html>
  );
}
