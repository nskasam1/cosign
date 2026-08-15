import { ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";
import UserSwitcher from "./UserSwitcher";

const RequireAuth = ({ children }: { children: ReactNode }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) return <UserSwitcher />;

  return <>{children}</>;
};

export default RequireAuth;
