interface PaginationProps {
  page: number;
  totalPages: number;
  totalElements: number;
  itemLabel: string;
  onChange: (page: number) => void;
}

export function Pagination({ page, totalPages, totalElements, itemLabel, onChange }: PaginationProps) {
  const hasPrevious = page > 0;
  const hasNext = page + 1 < totalPages;

  return (
    <nav className="pagination" aria-label={`${itemLabel} pages`}>
      <span className="muted">
        Page {totalPages === 0 ? 0 : page + 1} of {totalPages} · {totalElements} {itemLabel}
      </span>
      <div className="row">
        <button
          type="button"
          className="btn btn--small"
          disabled={!hasPrevious}
          onClick={() => onChange(page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn btn--small"
          disabled={!hasNext}
          onClick={() => onChange(page + 1)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}
