import { Link } from 'react-router-dom';

/** Friendly "page not found" state shown for unknown ids. */
export function NotFound() {
  return (
    <div className="not-found">
      <div className="not-found-glyph" aria-hidden="true">
        ?
      </div>
      <h1 className="not-found-title">Page not found</h1>
      <p className="not-found-body">
        That page is gone, or was never here. Pick something from the sidebar
        to get back to your workspace.
      </p>
      <Link to="/" className="not-found-link">
        Back to the first page
      </Link>
    </div>
  );
}
