import { useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { Topbar } from "./components/Topbar";
import { PageView } from "./components/PageView";
import { QuickFindHost } from "./components/QuickFind";
import { usePages } from "./store";

export function App() {
  const load = usePages((s) => s.load);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="app">
      <Sidebar />
      <div className="main">
        <Topbar />
        <div className="main-scroll">
          <PageView />
        </div>
      </div>
      <QuickFindHost />
    </div>
  );
}
