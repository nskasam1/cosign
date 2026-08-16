import { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import UserSwitcher from "./UserSwitcher";

const RequireAuth = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();

  // The last Phase-1 holding shape in the shell: a shadcn-token spinner on
  // `animate-spin`, which is Tailwind's own `spin 1s linear infinite` and so
  // is reached by none of the reduced-motion blocks in tokens.css or
  // index.css — every other animation in the app is on the duration tokens,
  // which go to 0ms. It was also the one place in the product that answered
  // a question with a shape instead of a sentence.
  if (loading) {
    return (
      <main data-auth-gate className="cs-wrap flex min-h-dvh items-center justify-center">
        <p className="cs-caps text-muted">Seeing if you’re signed in…</p>
      </main>
    );
  }

  if (!user) return <UserSwitcher />;

  return <>{children}</>;
};

export default RequireAuth;
