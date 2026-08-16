import { Caveat } from "next/font/google";

// Handwriting font used by the diary pages. Loaded only for the diary route
// via the --font-hand CSS variable (wired to `font-hand` in tailwind.config).
const caveat = Caveat({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-hand",
});

export default function DiaryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className={`${caveat.variable} h-full`}>
      {children}
    </div>
  );
}
