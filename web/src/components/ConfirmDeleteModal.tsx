interface ConfirmDeleteModalProps {
  pageTitle: string;
  onCancel: () => void;
  onConfirm: () => void;
  isPending?: boolean;
  /** Optional override for the body line below the title. */
  message?: string;
  /** Optional override for the warning callout. */
  warning?: string;
  /** What kind of object is being deleted; just changes the verb. */
  noun?: string;
}

/**
 * Confirmation modal for deleting a page. The naming of the page and the
 * warning that nested pages will be deleted are part of the contract.
 *
 * Reused for rows and properties in the database views with adapted copy
 * via the `message`, `warning` and `noun` overrides.
 */
export function ConfirmDeleteModal({
  pageTitle,
  onCancel,
  onConfirm,
  isPending = false,
  message,
  warning,
  noun = 'page',
}: ConfirmDeleteModalProps) {
  const defaultMessage =
    noun === 'page'
      ? 'This page will be permanently removed from your workspace.'
      : `This ${noun} will be permanently removed.`;
  const defaultWarning =
    noun === 'page'
      ? 'Everything nested inside this page is also deleted and cannot be recovered.'
      : `Deleting this ${noun} cannot be undone.`;
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-delete-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="modal">
        <div className="modal-body">
          <h2 id="confirm-delete-title" className="modal-title">
            Delete &ldquo;{pageTitle || 'Untitled'}&rdquo;?
          </h2>
          <p className="modal-message">{message ?? defaultMessage}</p>
          <p className="modal-warning">{warning ?? defaultWarning}</p>
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onCancel}
            disabled={isPending}
            data-testid="confirm-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={onConfirm}
            disabled={isPending}
            data-testid="confirm-delete"
            autoFocus
          >
            {isPending ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
