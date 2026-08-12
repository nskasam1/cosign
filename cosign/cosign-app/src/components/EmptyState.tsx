import { ReactNode } from "react";

interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}

// Deliberately not a generic "nothing here" placeholder — per the brief,
// this is often the only screen a first-time visitor (via a shared link)
// ever judges the app on, so every call site should pass copy specific to
// what's actually missing, not a reused fallback string.
const EmptyState = ({ icon, title, description, action }: EmptyStateProps) => (
  <div className="flex flex-col items-center justify-center text-center py-16 px-6 gap-3">
    <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center text-muted-foreground">
      {icon}
    </div>
    <h3 className="text-lg font-bold text-foreground">{title}</h3>
    <p className="text-sm text-muted-foreground max-w-xs">{description}</p>
    {action && <div className="mt-2">{action}</div>}
  </div>
);

export default EmptyState;
