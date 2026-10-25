import { Children, Fragment, isValidElement, useState } from 'react';
import type { ReactNode } from 'react';
import {
    getCoreRowModel,
    getSortedRowModel,
    useReactTable,
} from '@tanstack/react-table';
import type {
    ColumnDef,
    ColumnOrderState,
    SortingState,
    Table as TableInstance,
    VisibilityState,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ListFilter, Settings2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
    Popover,
    PopoverContent,
    PopoverHeader,
    PopoverTitle,
    PopoverTrigger,
} from '@/components/ui/popover';
import { TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { TableColumnOrder } from './table-column-order';

export type ViewColumn<T> = {
    id: string;
    label: string;
    value?: (row: T) => string | number | bigint | null | undefined;
    header?: ReactNode;
    className?: string;
    canHide?: boolean;
};
type Preferences = { order: ColumnOrderState; visibility: VisibilityState };
function completeOrder(saved: string[], ids: string[]) {
    const order = saved.filter((id) => ids.includes(id));
    for (const id of ids) {
        if (order.includes(id)) continue;
        const next = ids
            .slice(ids.indexOf(id) + 1)
            .find((candidate) => order.includes(candidate));
        order.splice(next ? order.indexOf(next) : order.length, 0, id);
    }
    return order;
}
function readPreferences(key: string, ids: string[]): Preferences {
    try {
        const saved: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
        if (
            saved &&
            typeof saved === 'object' &&
            'order' in saved &&
            'visibility' in saved &&
            Array.isArray(saved.order) &&
            saved.visibility &&
            typeof saved.visibility === 'object'
        ) {
            const order = [
                ...new Set(
                    saved.order.filter(
                        (id): id is string => typeof id === 'string',
                    ),
                ),
            ];
            return {
                order,
                visibility: Object.fromEntries(
                    Object.entries(saved.visibility).filter(
                        ([, value]) => typeof value === 'boolean',
                    ),
                ),
            };
        }
    } catch {
        /* Preferences are optional when storage is unavailable. */
    }
    return { order: ids, visibility: {} };
}

export function useTableView<T>({
    rows,
    columns,
    storageKey,
    sorting: externalSorting,
    onSortingChange,
}: {
    rows: T[];
    columns: ViewColumn<T>[];
    storageKey: string;
    sorting?: SortingState;
    onSortingChange?: (sorting: SortingState) => void;
}) {
    'use no memo'; // TanStack v8 exposes mutable table and column instances.

    const ids = columns.map((column) => column.id);
    const [stored, setStored] = useState(() => ({
        key: storageKey,
        ...readPreferences(storageKey, ids),
    }));
    const [sorting, setSorting] = useState<SortingState>([]);
    if (stored.key !== storageKey)
        setStored({ key: storageKey, ...readPreferences(storageKey, ids) });
    const order = completeOrder(stored.order, ids);
    const visibility = Object.fromEntries(
        columns.map((column) => [
            column.id,
            column.canHide === false || stored.visibility[column.id] !== false,
        ]),
    );
    function change(patch: Partial<Preferences>) {
        // Retain preferences for relation columns omitted in a detail context.
        const next = {
            ...stored,
            order: patch.order
                ? completeOrder(patch.order, [
                      ...new Set([...stored.order, ...ids]),
                  ])
                : stored.order,
            visibility: { ...stored.visibility, ...patch.visibility },
        };
        setStored(next);
        try {
            localStorage.setItem(
                storageKey,
                JSON.stringify({
                    order: next.order,
                    visibility: next.visibility,
                }),
            );
        } catch {
            /* Keep the view usable without storage. */
        }
    }
    const definitions: ColumnDef<T>[] = columns.map((column) => ({
        id: column.id,
        accessorFn: column.value,
        header: column.label,
        enableSorting: !!column.value,
        enableHiding: column.canHide !== false,
        sortUndefined: 'last',
    }));
    const table = useReactTable({
        data: rows,
        columns: definitions,
        state: {
            sorting: externalSorting ?? sorting,
            columnOrder: order,
            columnVisibility: visibility,
        },
        getCoreRowModel: getCoreRowModel(),
        getSortedRowModel: getSortedRowModel(),
        manualSorting: !!onSortingChange,
        autoResetPageIndex: false,
        enableMultiSort: false,
        onSortingChange: (update) => {
            const next =
                typeof update === 'function'
                    ? update(externalSorting ?? sorting)
                    : update;
            if (onSortingChange) onSortingChange(next);
            else setSorting(next);
        },
        onColumnOrderChange: (update) =>
            change({
                order: typeof update === 'function' ? update(order) : update,
            }),
        onColumnVisibilityChange: (update) =>
            change({
                visibility:
                    typeof update === 'function' ? update(visibility) : update,
            }),
        enableSortingRemoval: !onSortingChange,
        sortDescFirst: false,
    });
    return {
        table,
        columns,
        reset: () => {
            change({
                order: ids,
                visibility: Object.fromEntries(ids.map((id) => [id, true])),
            });
            if (!onSortingChange) setSorting([]);
        },
    };
}
export type TableView<T> = ReturnType<typeof useTableView<T>>;

export function TableFilters({
    children,
    title = 'Filtri',
    count = 0,
    disabled = false,
}: {
    children: ReactNode;
    title?: string;
    count?: number;
    disabled?: boolean;
}) {
    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button type="button" variant="outline" disabled={disabled}>
                    <ListFilter data-icon="inline-start" />
                    Filtri
                    {count > 0 && <Badge variant="secondary">{count}</Badge>}
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="start"
                className="max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto"
            >
                <PopoverHeader className="mb-4">
                    <PopoverTitle>{title}</PopoverTitle>
                </PopoverHeader>
                {children}
            </PopoverContent>
        </Popover>
    );
}
export function TableColumnSettings({
    children,
    disabled = false,
    iconOnly = false,
}: {
    children: ReactNode;
    disabled?: boolean;
    iconOnly?: boolean;
}) {
    return (
        <Popover>
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant={iconOnly ? 'ghost' : 'outline'}
                    size={iconOnly ? 'icon' : 'default'}
                    className={iconOnly ? 'size-8' : undefined}
                    disabled={disabled}
                    aria-label="Colonne"
                    title="Colonne"
                >
                    <Settings2 data-icon="inline-start" />
                    {!iconOnly && 'Colonne'}
                </Button>
            </PopoverTrigger>
            <PopoverContent
                align="end"
                className="max-h-[var(--radix-popover-content-available-height)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto"
            >
                <div className="flex flex-col gap-3">
                    <PopoverHeader>
                        <PopoverTitle>Configurazione colonne</PopoverTitle>
                    </PopoverHeader>
                    {children}
                </div>
            </PopoverContent>
        </Popover>
    );
}
export function TableViewSettings<T>({
    view,
    disabled = false,
    iconOnly = false,
}: {
    view: TableView<T>;
    disabled?: boolean;
    iconOnly?: boolean;
}) {
    'use no memo'; // TanStack v8 exposes mutable table and column instances.

    return (
        <TableColumnSettings disabled={disabled} iconOnly={iconOnly}>
            <TableColumnOrder
                disabled={disabled}
                columns={view.table.getAllLeafColumns().map((column) => ({
                    id: column.id,
                    label: view.columns.find((item) => item.id === column.id)!
                        .label,
                    visible: column.getIsVisible(),
                    canHide: column.getCanHide(),
                }))}
                onVisibilityChange={(id, visible) =>
                    view.table.getColumn(id)?.toggleVisibility(visible)
                }
                onOrderChange={(ids) => view.table.setColumnOrder(ids)}
            />
            <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={disabled}
                onClick={view.reset}
            >
                Ripristina configurazione
            </Button>
        </TableColumnSettings>
    );
}
export function TableViewHeader<T>({
    view,
    disabled = false,
    settingsColumn = 'actions',
}: {
    view: TableView<T>;
    disabled?: boolean;
    settingsColumn?: string | null;
}) {
    'use no memo'; // TanStack v8 exposes mutable table and column instances.

    const columns = view.table.getVisibleLeafColumns();
    const controlsColumn =
        settingsColumn === null
            ? undefined
            : (columns.find((column) => column.id === settingsColumn)?.id ??
              columns.at(-1)?.id);

    return (
        <TableHeader className="bg-muted [&_th]:font-semibold">
            <TableRow>
                {columns.map((column) => {
                    const definition = view.columns.find(
                        (item) => item.id === column.id,
                    )!;
                    const direction = column.getIsSorted();
                    const centered =
                        definition.className?.includes('text-center');
                    return (
                        <TableHead
                            key={column.id}
                            className={definition.className}
                            aria-sort={
                                direction === 'asc'
                                    ? 'ascending'
                                    : direction === 'desc'
                                      ? 'descending'
                                      : undefined
                            }
                        >
                            <div
                                className={cn(
                                    'flex items-center gap-1',
                                    centered && 'justify-center',
                                    centered &&
                                        column.id === controlsColumn &&
                                        'relative px-8',
                                    definition.className?.includes(
                                        'text-right',
                                    ) && 'justify-end',
                                )}
                            >
                                {column.getCanSort() ? (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        disabled={disabled}
                                        onClick={column.getToggleSortingHandler()}
                                        className={cn(
                                            definition.className?.includes(
                                                'text-right',
                                            ) && 'ml-auto',
                                        )}
                                        title={`Ordina per ${definition.label}`}
                                    >
                                        {definition.label}
                                        {direction === 'asc' ? (
                                            <ArrowUp data-icon="inline-end" />
                                        ) : direction === 'desc' ? (
                                            <ArrowDown data-icon="inline-end" />
                                        ) : null}
                                    </Button>
                                ) : (
                                    (definition.header ?? definition.label)
                                )}
                                {column.id === controlsColumn && (
                                    <span
                                        className={cn(
                                            'shrink-0',
                                            centered
                                                ? 'absolute right-0'
                                                : 'ml-auto',
                                        )}
                                    >
                                        <TableViewSettings
                                            view={view}
                                            disabled={disabled}
                                            iconOnly
                                        />
                                    </span>
                                )}
                            </div>
                        </TableHead>
                    );
                })}
            </TableRow>
        </TableHeader>
    );
}

// Keep the original keyed cell elements so changing columns never remounts an inline editor.
export function TableViewCells<T>({
    table,
    children,
}: {
    table: TableInstance<T>;
    children: ReactNode;
}) {
    'use no memo'; // TanStack v8 exposes mutable table and column instances.

    const cells = new Map<string, ReactNode>();
    function collect(nodes: ReactNode) {
        Children.forEach(nodes, (node) => {
            if (!isValidElement<{ children?: ReactNode }>(node)) return;
            if (node.type === Fragment) collect(node.props.children);
            else if (node.key !== null) cells.set(String(node.key), node);
        });
    }
    collect(children);
    return table.getVisibleLeafColumns().map((column) => cells.get(column.id));
}
