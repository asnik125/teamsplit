import type { ReactNode } from "react";

/** Compact, consistent page title under the app header. */
export function PageHeading({
  children,
  actions,
}: {
  children: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="page-heading-row">
      <h2 className="page-heading">{children}</h2>
      {actions ? <div className="page-heading-actions">{actions}</div> : null}
    </div>
  );
}
