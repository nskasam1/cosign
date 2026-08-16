import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import RequireAuth from "@/components/RequireAuth";
import Home from "./pages/Home";
import LogFlow from "./pages/LogFlow";
import Onboarding from "./pages/Onboarding";
import PlaceFlow from "./pages/PlaceFlow";
import RankingFlow from "./pages/RankingFlow";
import ShopDetail from "./pages/ShopDetail";
import ListDetail from "./pages/ListDetail";
import GroupSession from "./pages/GroupSession";
import GroupSessionNew from "./pages/GroupSessionNew";
import Profile from "./pages/Profile";
import NotFound from "./pages/NotFound.tsx";

const queryClient = new QueryClient();

// Route surfaces are grouped by whether they carry a login wall — public
// ones (share links, group-session voting) must stay reachable with no
// auth check per the brief; everything else sits behind RequireAuth.
const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<RequireAuth><Home /></RequireAuth>} />
            {/* The log and the head-to-head that follows it are two routes on
                purpose. The save enters /log/rank with `replace`, so the
                review step is off the stack: going back from the ranking
                screen lands on an earlier question with an empty draft, which
                the stale-step guard sends to the picker. Back can therefore
                only ever start a *new* log — it can never re-submit the one
                already written. */}
            <Route path="/log" element={<RequireAuth><LogFlow /></RequireAuth>} />
            <Route path="/log/rank/:shopId" element={<RequireAuth><PlaceFlow /></RequireAuth>} />
            <Route path="/rank" element={<RequireAuth><RankingFlow /></RequireAuth>} />
            <Route path="/group/new" element={<RequireAuth><GroupSessionNew /></RequireAuth>} />

            {/* Public, no auth wall */}
            {/* Onboarding *is* signup — behind RequireAuth it would show the
                switcher to the logged-out people it exists to serve. */}
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/shop/:shopId" element={<ShopDetail />} />
            <Route path="/lists/:listId" element={<ListDetail />} />
            <Route path="/group/:sessionId" element={<GroupSession />} />
            <Route path="/:username" element={<Profile />} />

            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
