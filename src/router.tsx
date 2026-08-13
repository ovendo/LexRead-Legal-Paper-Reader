import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { IS_DEMO } from "./demo";

interface RouterValue {
  path: string;
  navigate: (path: string) => void;
}

const RouterContext = createContext<RouterValue | null>(null);

function currentPath() {
  if (!IS_DEMO) return window.location.pathname === "/" ? "/workspace" : window.location.pathname;
  const hashPath = window.location.hash.replace(/^#/, "");
  return hashPath ? new URL(hashPath, window.location.origin).pathname : "/workspace";
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(currentPath);

  useEffect(() => {
    if (IS_DEMO) {
      if (!window.location.hash) window.history.replaceState({}, "", `${window.location.pathname}${window.location.search}#/workspace`);
      const onHashChange = () => setPath(currentPath());
      window.addEventListener("hashchange", onHashChange);
      return () => window.removeEventListener("hashchange", onHashChange);
    }
    if (window.location.pathname === "/") window.history.replaceState({}, "", "/workspace");
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((next: string) => {
    if (IS_DEMO) {
      window.location.hash = next;
      setPath(new URL(next, window.location.origin).pathname);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    window.history.pushState({}, "", next);
    setPath(new URL(next, window.location.origin).pathname);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const value = useMemo(() => ({ path, navigate }), [path, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter() {
  const value = useContext(RouterContext);
  if (!value) throw new Error("useRouter must be used inside RouterProvider");
  return value;
}
