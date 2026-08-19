import { Link, useLocation } from "react-router-dom";
import { useTitle } from "@/lib/title";
import Nothing from "@/components/Nothing";

const NotFound = () => {
  const location = useLocation();
  useTitle("Nothing at this address");

  return (
    <main className="cs-wrap flex min-h-dvh flex-col justify-center pb-10">
      <Nothing
        kicker="Nothing at this address"
        standalone
        title="There's no page here."
        body={`Cosign has no idea what ${location.pathname} was meant to be. The link may be old, or a place may have moved.`}
        action={
          <Link to="/" className="cs-pill-ghost">
            Back home
          </Link>
        }
      />
    </main>
  );
};

export default NotFound;
