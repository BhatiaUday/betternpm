import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { SiteFooter, SiteHeader } from "../components/site-chrome";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans"
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono"
});

export const metadata: Metadata = {
  metadataBase: new URL("https://betternpm.org"),
  title: "Better npm | Inspect npm packages before you run them",
  description:
    "AI-assisted npm package audits. Catch malware, typosquats, and known vulnerabilities before a package executes. Install with npm i -g betternpm-cli.",
  openGraph: {
    title: "Better npm | Inspect npm packages before you run them",
    description:
      "AI-assisted npm package audits. Catch malware, typosquats, and known vulnerabilities before a package executes.",
    url: "https://betternpm.org",
    siteName: "Better npm",
    type: "website"
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <SiteHeader />
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}