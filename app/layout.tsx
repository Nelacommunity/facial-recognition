import type { ReactNode } from "react";
import { AccountMenu } from "../components/auth/AccountMenu";
import "./globals.css";

const NAV = [
  { href: "/", label: "Live" },
  { href: "/people", label: "People" },
  { href: "/history", label: "History" },
  { href: "/settings", label: "Settings" },
];

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.svg" />
      </head>
      <body>
        <nav className="app-nav">
          <span className="font-semibold text-fg">Face ID</span>
          {NAV.map((item) => (
            <a key={item.href} href={item.href}>
              {item.label}
            </a>
          ))}
          <AccountMenu />
        </nav>
        {children}
      </body>
    </html>
  );
}
