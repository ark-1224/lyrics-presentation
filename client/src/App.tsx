import { ControlPanel } from "./ControlPanel";
import { DisplayPage } from "./DisplayPage";
import { Home } from "./Home";

// Only three fixed pages, so a simple path switch is enough (no router library needed).
type Page = "control" | "main" | "singers" | "home";

function pageFromPath(pathname: string): Page {
  if (pathname.startsWith("/control")) return "control";
  if (pathname.startsWith("/display/main")) return "main";
  if (pathname.startsWith("/display/singers")) return "singers";
  return "home";
}

export function App() {
  const page = pageFromPath(window.location.pathname);
  if (page === "control") return <ControlPanel />;
  if (page === "main" || page === "singers") return <DisplayPage kind={page} />;
  return <Home />;
}
