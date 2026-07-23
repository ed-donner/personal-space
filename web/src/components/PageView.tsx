import { usePages } from "../store";
import { BlockEditor, SaveIndicator } from "./BlockEditor";
import { useBlocks } from "../blocksStore";
import { DatabaseView } from "./DatabaseView";
import { RowPageView } from "./RowPageView";

export function PageView() {
  const { pages, selectedId } = usePages();
  const page = pages.find((p) => p.id === selectedId) ?? null;
  const blocksPageId = useBlocks((s) => s.pageId);

  if (!page) {
    return (
      <div className="welcome">
        <h1>Welcome to Personal Space</h1>
        <p>Pick a page on the left to view it, or create a new one to get started.</p>
      </div>
    );
  }

  // Route by page type. Rows and databases are pages too, but they show
  // their own custom views.
  if (page.type === "database") {
    return <DatabaseView database={page} />;
  }
  if (page.type === "row") {
    return <RowPageView row={page} />;
  }

  const blocksAreForThisPage = blocksPageId === page.id;

  return (
    <article>
      <header className="page-header">
        <div className="page-icon" aria-hidden="true">
          {page.icon || "📄"}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h1 className="page-title">{page.title}</h1>
          <div className="page-meta">
            <span className="page-meta-tag">{page.type}</span>
            {blocksAreForThisPage && <SaveIndicator />}
          </div>
        </div>
      </header>
      <section className="page-body">
        <BlockEditor pageId={page.id} />
      </section>
    </article>
  );
}
