import Link from "next/link";
import type { ReactNode } from "react";

interface Crumb {
  label: string;
  href?: string;
}

export default function CraneHeader({
  crumbs = [],
  right,
  children,
  homeHref = "/",
}: {
  crumbs?: Crumb[];
  right?: ReactNode;
  children?: ReactNode;
  homeHref?: string;
}) {
  return (
    <header
      className="sticky top-0 z-10 flex items-center h-16 px-6 border-b border-dark-800 shrink-0 bg-dark-950/80 backdrop-blur-md"
    >
      <a
        href="https://crane-ai.co.uk"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Crane AI homepage"
        className="flex items-center gap-2 shrink-0 hover:opacity-80 transition-opacity"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/crane-logo.svg" alt="" aria-hidden="true" width={28} height={28} className="h-7 w-auto" />
        <span className="text-sm font-medium text-white">
          crane
        </span>
      </a>

      <span className="mx-2.5 text-dark-700 shrink-0">/</span>
      <Link
        href={homeHref}
        className="text-sm font-medium text-dark-400 hover:text-dark-200 transition-colors shrink-0"
      >
        Sherlock
      </Link>

      {crumbs.map((crumb, i) => (
        <span key={i} className="flex items-center shrink-0">
          <span className="mx-2.5 text-dark-700">/</span>
          {crumb.href ? (
            <Link
              href={crumb.href}
              className="text-sm text-dark-400 hover:text-dark-200 transition-colors"
            >
              {crumb.label}
            </Link>
          ) : (
            <span className="text-sm text-dark-300">{crumb.label}</span>
          )}
        </span>
      ))}

      {children}

      {right && <div className="ml-auto flex items-center gap-3">{right}</div>}
    </header>
  );
}
