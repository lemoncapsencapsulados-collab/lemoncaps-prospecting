interface OptionalLinkProps {
  readonly href: string | null;
  readonly className?: string;
  readonly children: string;
  /** Shown when the link is absent, so an unconfigured value never renders a dead link. */
  readonly missingLabel: string;
}

export function OptionalLink({ href, className, children, missingLabel }: OptionalLinkProps) {
  if (!href) {
    return <span className="muted">{missingLabel}</span>;
  }

  return (
    <a className={className} href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}
