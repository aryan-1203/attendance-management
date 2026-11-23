import * as React from "react";
import {
  flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState,
  type OnChangeFn,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/misc";

/** Left offset (px) for a sticky column, summing prior sticky column sizes. */
export function stickyLeftOffset(sizes: number[], index: number): number {
  let left = 0;
  for (let i = 0; i < index; i++) left += sizes[i] ?? 0;
  return left;
}

/** TanStack table with sticky header + leftmost columns, optional virtualization (500+ rows). */
export function DataTable<T>({ columns, data, loading, onRowClick, empty, sorting, onSortingChange, manualSorting,
  virtual = false, maxHeight = "70vh", rowKey, className, stickyFirst = true, stickyColumns, footer }: {
  columns: ColumnDef<T, any>[]; data: T[]; loading?: boolean; onRowClick?: (row: T) => void;
  empty?: React.ReactNode; sorting?: SortingState; onSortingChange?: OnChangeFn<SortingState>;
  manualSorting?: boolean; virtual?: boolean; maxHeight?: string; rowKey?: (row: T) => string | number;
  className?: string; stickyFirst?: boolean; /** How many leading columns stay pinned while scrolling horizontally. */
  stickyColumns?: number; footer?: React.ReactNode;
}) {
  const stickyCount = stickyColumns ?? (stickyFirst ? 1 : 0);
  const [localSort, setLocalSort] = React.useState<SortingState>([]);
  const table = useReactTable({
    data, columns,
    state: { sorting: sorting ?? localSort },
    onSortingChange: onSortingChange ?? setLocalSort,
    manualSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: manualSorting ? undefined : getSortedRowModel(),
    getRowId: rowKey ? (r) => String(rowKey(r)) : undefined,
    defaultColumn: { size: 150 },
  });
  const parentRef = React.useRef<HTMLDivElement>(null);
  const rows = table.getRowModel().rows;
  const virt = useVirtualizer({ count: rows.length, getScrollElement: () => parentRef.current, estimateSize: () => 44,
    overscan: 12, enabled: virtual });
  const items = virtual ? virt.getVirtualItems() : null;
  const padTop = items && items.length ? items[0].start : 0;
  const padBottom = items && items.length ? virt.getTotalSize() - items[items.length - 1].end : 0;
  const visible = items ? items.map((i) => rows[i.index]) : rows;
  const leafHeaders = table.getHeaderGroups().at(-1)?.headers ?? [];
  const stickySizes = leafHeaders.slice(0, stickyCount).map((h) => h.getSize());

  return (
    <div ref={parentRef} className={cn("relative overflow-auto rounded-xl border bg-card shadow-e1 scrollbar-thin", className)}
      style={{ maxHeight }}>
      <table className="w-full border-separate border-spacing-0 text-sm">
        <thead className="sticky top-0 z-20">
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h, i) => {
                const sortable = h.column.getCanSort();
                const dir = h.column.getIsSorted();
                const pinned = i < stickyCount;
                return (
                  <th key={h.id} scope="col"
                    aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
                    className={cn("glass whitespace-nowrap border-b px-3 py-2.5 text-left text-xs font-semibold text-muted-foreground",
                      pinned && "sticky z-30",
                      pinned && i === stickyCount - 1 && "border-r",
                      (h.column.columnDef.meta as any)?.align === "right" && "text-right")}
                    style={{
                      width: h.getSize() !== 150 ? h.getSize() : undefined,
                      left: pinned ? stickyLeftOffset(stickySizes, i) : undefined,
                    }}>
                    {h.isPlaceholder ? null : sortable ? (
                      <button type="button" onClick={h.column.getToggleSortingHandler()}
                        className="inline-flex cursor-pointer items-center gap-1 rounded hover:text-foreground">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {dir === "asc" ? <ArrowUp className="size-3" /> : dir === "desc" ? <ArrowDown className="size-3" /> :
                          <ChevronsUpDown className="size-3 opacity-40" />}
                      </button>
                    ) : flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {loading && Array.from({ length: 8 }).map((_, r) => (
            <tr key={`s${r}`}>{columns.map((_c, i) => (
              <td key={i} className="border-b px-3 py-3"><Skeleton className="h-4 w-full max-w-[160px]" /></td>
            ))}</tr>
          ))}
          {!loading && padTop > 0 && <tr style={{ height: padTop }} />}
          {!loading && visible.map((row) => (
            <tr key={row.id} onClick={onRowClick ? () => onRowClick(row.original) : undefined}
              onKeyDown={onRowClick ? (e) => { if (e.key === "Enter") onRowClick(row.original); } : undefined}
              tabIndex={onRowClick ? 0 : undefined}
              className={cn("group transition-colors", onRowClick && "cursor-pointer hover:bg-muted/60 focus-visible:bg-muted/60")}>
              {row.getVisibleCells().map((cell, i) => {
                const pinned = i < stickyCount;
                return (
                  <td key={cell.id}
                    className={cn("border-b px-3 py-2.5 align-middle",
                      pinned && "sticky z-10 bg-card group-hover:bg-muted/60",
                      pinned && i === stickyCount - 1 && "border-r",
                      (cell.column.columnDef.meta as any)?.align === "right" && "text-right tnum")}
                    style={{ left: pinned ? stickyLeftOffset(stickySizes, i) : undefined }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                );
              })}
            </tr>
          ))}
          {!loading && padBottom > 0 && <tr style={{ height: padBottom }} />}
        </tbody>
        {footer}
      </table>
      {!loading && rows.length === 0 && <div className="p-2">{empty}</div>}
    </div>
  );
}

export function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  return (
    <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
      <span className="tnum">{total} result{total === 1 ? "" : "s"}</span>
      <div className="flex items-center gap-2">
        <button className="rounded-md border bg-surface px-2.5 py-1 shadow-e1 disabled:opacity-40 cursor-pointer" disabled={page <= 1}
          onClick={() => onPage(page - 1)}>Previous</button>
        <span className="tnum">{page} / {pages}</span>
        <button className="rounded-md border bg-surface px-2.5 py-1 shadow-e1 disabled:opacity-40 cursor-pointer" disabled={page >= pages}
          onClick={() => onPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}
