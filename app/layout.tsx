import type { Metadata } from "next";
import "@fontsource-variable/noto-sans-kannada";
import "./globals.css";

export const metadata: Metadata = {
  title: "ಧ್ವನಿ (Dhwani) – Kannada Text to Speech",
  description: "Turn Kannada text into speech with a local male voice. Listen, adjust and download as MP3.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
