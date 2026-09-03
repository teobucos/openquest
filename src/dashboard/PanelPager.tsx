import type { MouseEvent } from "react";

export interface PanelPagerProps {
  readonly label: string;
  readonly onPageChange: (page: number) => void;
  readonly page: number;
  readonly pageCount: number;
}

function stopHeadingToggle(event: MouseEvent<HTMLElement>) {
  event.stopPropagation();
}

export function PanelPager({ label, onPageChange, page, pageCount }: PanelPagerProps) {
  if (pageCount <= 1) return null;
  return (
    <nav className="panel-pager" aria-label={label} onClick={stopHeadingToggle}>
      <button
        type="button"
        aria-label="Previous page"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        ‹
      </button>
      <span>{page} / {pageCount}</span>
      <button
        type="button"
        aria-label="Next page"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        ›
      </button>
    </nav>
  );
}
