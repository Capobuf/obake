import { budgetSummaryColumns } from './budget-summary-columns';
import { BudgetPrintDialog } from './budget-print-dialog';
import { captureBudgetReport } from './budget-report';
import type { BudgetReportData } from './budget-report';
import { InlineEdit } from './inline-edit';
import {
    Fragment,
    useCallback,
    useEffect,
    useId,
    useImperativeHandle,
    type Ref,
    useMemo,
    useState,
} from 'react';
import { Link, router, usePage } from '@inertiajs/react';
import { toast } from 'sonner';
import {
    closestCenter,
    pointerWithin,
    DndContext,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent } from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    flexRender,
    getCoreRowModel,
    getFilteredRowModel,
    getSortedRowModel,
    getGroupedRowModel,
    getExpandedRowModel,
    useReactTable,
} from '@tanstack/react-table';
import type {
    ColumnDef,
    Cell,
    ColumnOrderState,
    ExpandedState,
    SortingState,
    VisibilityState,
    RowSelectionState,
    Row,
} from '@tanstack/react-table';
import {
    ArrowDown,
    ArrowUp,
    ArrowUpRight,
    ChevronDown,
    ChevronRight,
    GripVertical,
    Plus,
    Ellipsis,
    TriangleAlert,
    X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { InputGroup, InputGroupInput } from '@/components/ui/input-group';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import {
    Table,
    TableHeader,
    TableHead,
    TableBody,
    TableCell,
    TableRow,
    TableFooter,
} from '@/components/ui/table';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogCancel,
    AlertDialogAction,
} from '@/components/ui/alert-dialog';
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from '@/components/ui/tooltip';
import {
    Empty,
    EmptyHeader,
    EmptyTitle,
    EmptyDescription,
} from '@/components/ui/empty';
import { cn } from '@/lib/utils';
import { clearLocalUndo, recordLocalUndo } from '@/lib/undo-state';
import { BudgetCenterSelect } from './budget-entry-sheet';
import { budgetFiltersUrl, readBudgetFilters } from './budget-filters';
import type { BudgetFilters } from './budget-filters';
import { TableColumnOrder } from './table-column-order';
import { TableColumnSettings, TableFilters } from './table-view';
import { draftLines, ExpenseLines } from './expense-lines';
import { CostCenterTags } from './cost-center-tags';
import { api, decimalInput, money, varianceTextClass } from './helpers';
import { budgetLabels, budgetTypes } from './budget-types';
import type {
    BudgetEntry,
    BudgetMutate,
    BudgetSnapshot,
    BudgetType,
} from './budget-types';
import type { Expense, Option } from './types';

const columnNames: Record<string, string> = {
    select: 'Selezione',
    expand: 'Espansione',
    description: 'Descrizione',
    type: 'Tipo',
    vendor: 'Fornitore',
    center: 'Centro di costo',
    allocated: 'Allocato',
    actual: 'Effettivo',
    variance: 'Scostamento',
    actions: 'Azioni',
};
const defaultOrder = Object.keys(columnNames);
function missingAmounts(allocated: boolean, actual: boolean) {
    return !allocated && actual ? 'Solo stima' : null;
}

function completionLabel(entry: BudgetEntry) {
    return entry.estimated_count > 0 ? 'Solo stima' : null;
}

function focusCompletion(id: number) {
    const detail = document.getElementById(`budget-detail-${id}`);
    const estimates = Array.from(
        document.querySelectorAll<HTMLElement>(
            `[data-budget-entry="${id}"] [data-budget-estimate="true"], [data-budget-detail-owner="${id}"] [data-budget-estimate="true"]`,
        ),
    );
    const controls =
        'input:not(:disabled), button:not(:disabled), a[href], [role="button"][tabindex="0"]';
    const target =
        estimates
            .map((element) =>
                element.matches(controls)
                    ? element
                    : element.querySelector<HTMLElement>(controls),
            )
            .find((element) => element !== null) ??
        estimates[0] ??
        detail;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({
        block: 'center',
        inline: 'nearest',
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'auto'
            : 'smooth',
    });
}
type Preferences = {
    visibility: VisibilityState;
    order: ColumnOrderState;
    group: 'type' | 'center';
};
function readPreferences(key: string): Preferences {
    const defaults: Preferences = {
        visibility: { type: false },
        order: defaultOrder,
        group: 'type',
    };
    try {
        const saved = JSON.parse(
            localStorage.getItem(key) ?? 'null',
        ) as Partial<Preferences> | null;
        if (!saved) return defaults;
        return {
            visibility: {
                ...saved.visibility,
                select: true,
                expand: true,
                description: true,
                actions: true,
            },
            order: [
                ...new Set([
                    ...(saved.order ?? []).filter((id) =>
                        defaultOrder.includes(id),
                    ),
                    ...defaultOrder,
                ]),
            ],
            group: saved.group === 'center' ? 'center' : 'type',
        };
    } catch {
        return defaults;
    }
}

type SaveRecord = (
    resource: string,
    id: number,
    changes: Record<string, unknown>,
) => Promise<void>;

// Cell templates are pure render callbacks. Calling them keeps editor components
// mounted when refreshed column definitions change during a save.
function renderCell(cell: Cell<BudgetEntry, unknown>) {
    const renderer = cell.column.columnDef.cell;
    return typeof renderer === 'function'
        ? renderer(cell.getContext())
        : renderer;
}

function Attribution({
    expense,
}: {
    expense: BudgetEntry['expenses'][number];
}) {
    if (expense.contributes) return null;
    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <span
                    tabIndex={0}
                    className="block rounded-sm text-xs text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                    {expense.counted_in
                        ? `Conteggiata in: ${expense.counted_in}`
                        : 'Non conteggiata'}
                </span>
            </TooltipTrigger>
            <TooltipContent>
                {expense.counted_in
                    ? 'Gli importi contribuiscono soltanto alla voce indicata, senza duplicare i totali.'
                    : 'Gli importi di questa spesa non contribuiscono ai totali del Budget.'}
            </TooltipContent>
        </Tooltip>
    );
}

function ExpenseAmount({
    value,
    label,
    busy,
    highlightEstimate,
    expense,
    field,
    onRecordSave,
    onExpenseEdit,
}: {
    value: string | null | undefined;
    label: string;
    busy: boolean;
    highlightEstimate?: boolean;
    expense: Expense;
    field: 'allocated_amount' | 'actual_amount';
    onRecordSave: SaveRecord;
    onExpenseEdit: (id: number) => void;
}) {
    const display = money(value, '');
    return (
        <div
            tabIndex={-1}
            data-budget-estimate={highlightEstimate && value == null}
            className={cn(
                highlightEstimate &&
                    value == null &&
                    'rounded bg-accent ring-1 ring-primary/40 ring-inset',
            )}
        >
            {expense.lines?.length ? (
                <Button
                    variant="ghost"
                    size="sm"
                    className="h-auto min-h-8 w-full justify-end financial-value"
                    aria-label={`${label.replace(/^Modifica /, '')}: ${display}. Modifica le righe economiche`}
                    disabled={busy}
                    title="Importo calcolato dalle righe economiche: apri la modifica della spesa"
                    onClick={() => onExpenseEdit(expense.id)}
                >
                    {display}
                </Button>
            ) : (
                <InlineEdit
                    value={value}
                    display={display}
                    label={label.replace(/^Modifica /, '')}
                    disabled={busy}
                    className="min-h-5 text-right financial-value"
                    onSave={(value) =>
                        onRecordSave('expenses', expense.id, {
                            [field]: decimalInput(value),
                        })
                    }
                />
            )}
        </div>
    );
}

export function ExpenseRows({
    entry,
    columnIds,
    slug,
    busy,
    highlightEstimate,
    onExpenseEdit,
    onRecordSave,
}: {
    entry: BudgetEntry;
    columnIds: string[];
    slug: string;
    busy: boolean;
    highlightEstimate: boolean;
    onExpenseEdit: (id: number) => void;
    onRecordSave: SaveRecord;
}) {
    const descriptionIndex = Math.max(0, columnIds.indexOf('description'));
    return entry.expenses.map((expense, index) => {
        const key = `${entry.id}:${expense.id}`;
        const hasLines = !!expense.lines?.length;
        const missing =
            expense.contributes && entry.estimated_count > 0
                ? missingAmounts(
                      expense.allocated_amount == null,
                      expense.actual_amount == null,
                  )
                : null;
        const hiddenMissing =
            missing &&
            (hasLines ||
                (expense.allocated_amount == null &&
                    !columnIds.includes('allocated')) ||
                (expense.actual_amount == null &&
                    !columnIds.includes('actual')));
        return (
            <Fragment key={expense.id}>
                <TableRow
                    id={index === 0 ? `budget-detail-${entry.id}` : undefined}
                    tabIndex={-1}
                    data-budget-detail-owner={entry.id}
                    className={cn(
                        'bg-muted/20 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                        !expense.contributes && 'text-muted-foreground',
                    )}
                >
                    {columnIds.map((id) => (
                        <TableCell
                            key={id}
                            className={cn(
                                'py-1.5',
                                ['allocated', 'actual', 'variance'].includes(
                                    id,
                                ) && 'text-right financial-value tabular-nums',
                                id === 'description' && 'whitespace-normal',
                            )}
                        >
                            {id === 'description' ? (
                                <div className="ml-4 flex min-w-48 flex-col gap-1 border-l-2 border-border pl-4">
                                    <div className="flex items-center gap-1">
                                        <InlineEdit
                                            value={expense.title}
                                            label={`Titolo di ${expense.title}`}
                                            disabled={busy}
                                            className="font-medium break-words"
                                            onSave={(value) =>
                                                onRecordSave(
                                                    'expenses',
                                                    expense.id,
                                                    { title: value },
                                                )
                                            }
                                        />
                                        <Button
                                            asChild
                                            variant="ghost"
                                            size="icon"
                                            className="shrink-0"
                                        >
                                            <Link
                                                href={`/t/${slug}/expenses/${expense.id}`}
                                                aria-label={`Apri ${expense.title}`}
                                            >
                                                <ArrowUpRight />
                                            </Link>
                                        </Button>
                                    </div>
                                    {hiddenMissing && (
                                        <Button
                                            variant="link"
                                            size="sm"
                                            className={cn(
                                                'h-auto justify-start px-0',
                                                highlightEstimate &&
                                                    'bg-accent ring-1 ring-primary/40',
                                            )}
                                            data-budget-estimate={
                                                highlightEstimate
                                            }
                                            disabled={busy}
                                            onClick={() =>
                                                onExpenseEdit(expense.id)
                                            }
                                        >
                                            {missing}
                                        </Button>
                                    )}
                                    <Attribution expense={expense} />
                                </div>
                            ) : id === 'type' ? (
                                <Badge variant="secondary">Spesa</Badge>
                            ) : id === 'vendor' ? (
                                expense.vendor ? (
                                    <Link
                                        href={`/t/${slug}/vendors/${expense.vendor.id}`}
                                        className="text-foreground"
                                    >
                                        {expense.vendor.name}
                                    </Link>
                                ) : (
                                    'Senza fornitore'
                                )
                            ) : id === 'center' ? (
                                expense.cost_centers?.length ? (
                                    <CostCenterTags
                                        centers={expense.cost_centers}
                                    />
                                ) : (
                                    'Senza centro di costo'
                                )
                            ) : id === 'variance' && !hasLines ? (
                                <span
                                    className={varianceTextClass(
                                        expense.variance,
                                    )}
                                >
                                    {expense.variance == null
                                        ? 'Non confrontabile'
                                        : money(expense.variance)}
                                </span>
                            ) : (id === 'allocated' || id === 'actual') &&
                              !hasLines ? (
                                <ExpenseAmount
                                    value={
                                        expense.contributes
                                            ? expense[
                                                  id === 'allocated'
                                                      ? 'allocated_amount'
                                                      : 'actual_amount'
                                              ]
                                            : null
                                    }
                                    label={`Modifica ${columnNames[id]} della spesa ${expense.title}`}
                                    busy={busy}
                                    highlightEstimate={
                                        highlightEstimate && expense.contributes
                                    }
                                    expense={expense}
                                    field={
                                        id === 'allocated'
                                            ? 'allocated_amount'
                                            : 'actual_amount'
                                    }
                                    onExpenseEdit={onExpenseEdit}
                                    onRecordSave={onRecordSave}
                                />
                            ) : id === 'actions' ? (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            size="icon"
                                            variant="ghost"
                                            disabled={busy}
                                            aria-label={`Azioni per la spesa ${expense.title}`}
                                        >
                                            <Ellipsis />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuGroup>
                                            <DropdownMenuItem
                                                onSelect={() =>
                                                    onExpenseEdit(expense.id)
                                                }
                                            >
                                                Righe e collegamenti
                                            </DropdownMenuItem>
                                        </DropdownMenuGroup>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            ) : null}
                        </TableCell>
                    ))}
                </TableRow>
                {hasLines && (
                    <TableRow data-budget-detail-owner={entry.id}>
                        {descriptionIndex > 0 && (
                            <TableCell
                                colSpan={descriptionIndex}
                                className="bg-muted/20 p-0"
                            />
                        )}
                        <TableCell
                            colSpan={columnIds.length - descriptionIndex}
                            className="bg-muted/20 px-2 py-3 whitespace-normal"
                        >
                            <div
                                id={`budget-expense-lines-${key}`}
                                className="ml-8 min-w-0 border-l-2 border-border pl-4"
                            >
                                <ExpenseLines
                                    readOnly
                                    showSummary={false}
                                    showHeading={false}
                                    showFilters={false}
                                    contractMode={!!expense.contract_id}
                                    lines={draftLines(expense)}
                                />
                            </div>
                        </TableCell>
                    </TableRow>
                )}
            </Fragment>
        );
    });
}

function SortableBudgetRow({
    row,
    disabled,
    disabledReason,
}: {
    row: Row<BudgetEntry>;
    disabled: boolean;
    disabledReason: string;
}) {
    'use no memo'; // TanStack row selection is read through a mutable row instance.
    const {
        attributes,
        listeners,
        setNodeRef,
        setActivatorNodeRef,
        transform,
        isDragging,
    } = useSortable({ id: row.id, disabled });
    return (
        <TableRow
            ref={setNodeRef}
            data-budget-entry={row.original.id}
            style={{
                transform: CSS.Translate.toString(transform),
                position: 'relative',
                zIndex: isDragging ? 1 : undefined,
            }}
            data-state={row.getIsSelected() ? 'selected' : undefined}
            className={cn(
                row.original.type === 'expense' &&
                    row.original.expenses[0] &&
                    !row.original.expenses[0].contributes &&
                    'text-muted-foreground',
                isDragging && 'bg-accent opacity-80',
            )}
        >
            {row.getVisibleCells().map((cell) => (
                <TableCell
                    key={cell.id}
                    className={cn(
                        'py-1.5',
                        ['allocated', 'actual', 'variance'].includes(
                            cell.column.id,
                        ) && 'text-right financial-value tabular-nums',
                    )}
                >
                    {cell.column.id === 'expand' ? (
                        <div className="flex items-center">
                            <Button
                                ref={setActivatorNodeRef}
                                size="icon"
                                variant="ghost"
                                className="cursor-grab touch-none active:cursor-grabbing aria-disabled:cursor-default aria-disabled:opacity-40"
                                {...attributes}
                                {...listeners}
                                aria-disabled={disabled}
                                aria-label={`Riordina ${row.original.description}${disabled ? `: ${disabledReason}` : ''}`}
                            >
                                <GripVertical />
                            </Button>
                            {renderCell(cell)}
                        </div>
                    ) : (
                        renderCell(cell)
                    )}
                </TableCell>
            ))}
        </TableRow>
    );
}

function FilterSelect({
    value,
    onChange,
    label,
    options,
}: {
    value: string;
    onChange: (value: string) => void;
    label: string;
    options: { value: string; label: string }[];
}) {
    const id = useId();
    return (
        <Field>
            <FieldLabel htmlFor={id}>{label}</FieldLabel>
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger id={id} aria-label={label} className="w-full">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent avoidCollisions>
                    <SelectGroup>
                        {options.map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                                {option.label}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
        </Field>
    );
}

function EntryDetail({
    entry,
    slug,
    year,
    busy,
    onExpenseEdit,
    highlightEstimate,
}: {
    entry: BudgetEntry;
    slug: string;
    year: number;
    busy: boolean;
    onExpenseEdit: (id: number) => void;
    highlightEstimate: boolean;
}) {
    const expense = entry.expenses[0];
    const missing = completionLabel(entry);
    return (
        <div className="flex min-w-0 flex-col gap-3">
            {entry.estimated_count > 0 && missing && (
                <div
                    tabIndex={-1}
                    data-budget-estimate={highlightEstimate}
                    className={cn(
                        'flex flex-wrap items-center gap-3 rounded text-sm focus-visible:ring-2 focus-visible:ring-ring',
                        highlightEstimate && 'bg-accent ring-1 ring-primary/40',
                    )}
                >
                    <span>{missing}</span>
                    {entry.type === 'expense' ? (
                        <Button
                            variant="link"
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                                onExpenseEdit(expense?.id ?? entry.source_id!)
                            }
                        >
                            Modifica importi
                        </Button>
                    ) : (
                        <Button variant="link" size="sm" asChild>
                            <Link
                                href={
                                    entry.type === 'contract'
                                        ? `/t/${slug}/expenses/create?contract_id=${entry.source_id}&year=${year}`
                                        : `/t/${slug}/projects/${entry.source_id}`
                                }
                            >
                                {entry.type === 'contract'
                                    ? 'Aggiungi spesa al contratto'
                                    : 'Apri progetto'}
                            </Link>
                        </Button>
                    )}
                </div>
            )}
            {entry.type === 'expense' && !!expense?.lines?.length && (
                <ExpenseLines
                    readOnly
                    showSummary={false}
                    showHeading={false}
                    showFilters={false}
                    contractMode={!!expense.contract_id}
                    lines={draftLines(expense)}
                />
            )}
        </div>
    );
}

export type BudgetTableHandle = {
    printReport: () => void;
    exportFilters: () => { year: number; entry_ids: string };
};

export function BudgetTable({
    ref,
    budget,
    tenantName,
    logoUrl,
    slug,
    year,
    budgetYearId,
    centers,
    busy,
    loading,
    mutate,
    onAdd,
    onMissing,
    onImport,
    onExpenseEdit,
    onRecordSave,
}: {
    ref?: Ref<BudgetTableHandle>;
    budget: BudgetSnapshot;
    tenantName: string;
    logoUrl?: string | null;
    slug: string;
    year: number;
    budgetYearId: number;
    centers: Option[];
    busy: boolean;
    loading: boolean;
    mutate: BudgetMutate;
    onAdd: () => void;
    onMissing: () => void;
    onImport: () => void;
    onExpenseEdit: (id: number) => void;
    onRecordSave: (
        resource: string,
        id: number,
        changes: Record<string, unknown>,
    ) => Promise<void>;
}) {
    'use no memo'; // TanStack v8 exposes a mutable table instance to the renderer.
    const [report, setReport] = useState<BudgetReportData | null>(null);
    const key = `mp3:budget:grid:v1:${slug}`;
    const [preferences, setPreferences] = useState(() => readPreferences(key));
    const [sorting, setSorting] = useState<SortingState>([]);
    const [selection, setSelection] = useState<RowSelectionState>({});
    const [expanded, setExpanded] = useState<ExpandedState>(true);
    const [details, setDetails] = useState<number[]>([]);
    const [completionTarget, setCompletionTarget] = useState<{
        id: number;
    } | null>(null);
    const { url } = usePage();
    const vendors = [
        ...new Map(
            budget.entries
                .filter((row) => row.vendor)
                .map((row) => [row.vendor!.id, row.vendor!]),
        ).values(),
    ];
    const filters = readBudgetFilters(url, vendors, centers);
    const {
        search: querySearch,
        type: typeFilter,
        vendor_id: vendor,
        cost_center_id: center,
    } = filters;
    // Keep typing immediate while Inertia queues client-side history updates.
    const [search, setSearch] = useState(querySearch);
    useEffect(
        () =>
            router.on('navigate', ({ detail }) => {
                setSearch(
                    new URL(
                        detail.page.url,
                        window.location.origin,
                    ).searchParams.get('search') ?? '',
                );
            }),
        [],
    );
    const canonicalUrl = budgetFiltersUrl(url, filters, year);
    useEffect(() => {
        if (canonicalUrl !== url)
            router.replace({
                url: canonicalUrl,
                preserveState: true,
                preserveScroll: true,
            });
    }, [canonicalUrl, url]);
    function changeFilters(patch: Partial<BudgetFilters>) {
        router.replace({
            url: budgetFiltersUrl(url, { ...filters, search, ...patch }, year),
            preserveState: true,
            preserveScroll: true,
        });
    }
    const hasFilters =
        !!search ||
        typeFilter !== 'all' ||
        vendor !== 'all' ||
        center !== 'all';
    const filterKey = JSON.stringify([search, typeFilter, vendor, center]);
    const [filteredBudget, setFilteredBudget] = useState<{
        source: BudgetSnapshot;
        key: string;
        result: BudgetSnapshot;
    } | null>(null);
    const summary = hasFilters
        ? filteredBudget?.source === budget && filteredBudget.key === filterKey
            ? filteredBudget.result
            : null
        : budget;
    const groupTotal = useCallback(
        (entry?: BudgetEntry) => {
            if (!entry || !summary) return undefined;
            return preferences.group === 'type'
                ? summary.groups[entry.type]
                : summary.cost_center_groups[
                      String(entry.cost_center_id ?? 'none')
                  ];
        },
        [summary, preferences.group],
    );
    const [removing, setRemoving] = useState<number[]>([]);
    const [dragging, setDragging] = useState(false);
    const [detailHeights, setDetailHeights] = useState<Record<number, number>>(
        {},
    );
    const dndId = useId();
    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
        useSensor(KeyboardSensor, {
            coordinateGetter: sortableKeyboardCoordinates,
            scrollBehavior: 'auto',
        }),
    );
    useEffect(() => () => clearLocalUndo(`/t/${slug}`), [slug]);
    function changePreferences(next: Preferences) {
        if (JSON.stringify(next) === JSON.stringify(preferences)) return;
        const previous = preferences;
        setPreferences(next);
        recordLocalUndo({
            scope: `/t/${slug}`,
            label: 'Configurazione colonne',
            undo: () => setPreferences(previous),
            redo: () => setPreferences(next),
        });
    }
    useEffect(() => {
        if (completionTarget !== null) focusCompletion(completionTarget.id);
    }, [completionTarget]);
    const openCompletion = useCallback((id: number) => {
        setDetails((current) =>
            current.includes(id) ? current : [...current, id],
        );
        setCompletionTarget({ id });
    }, []);
    useEffect(() => {
        try {
            localStorage.setItem(key, JSON.stringify(preferences));
        } catch {
            /* Grid remains usable when browser storage is unavailable. */
        }
    }, [key, preferences]);
    const batch = useCallback(
        (action: string, ids: number[]) =>
            mutate('entries', 'PATCH', { action, ids }),
        [mutate],
    );
    const toggleDetail = useCallback(
        (id: number) =>
            setDetails((current) =>
                current.includes(id)
                    ? current.filter((value) => value !== id)
                    : [...current, id],
            ),
        [],
    );
    const columns = useMemo<ColumnDef<BudgetEntry>[]>(
        () => [
            {
                id: 'select',
                enableHiding: false,
                header: ({ table }) => (
                    <Checkbox
                        aria-label="Seleziona tutte le voci filtrate"
                        checked={
                            table.getIsAllRowsSelected()
                                ? true
                                : table.getIsSomeRowsSelected()
                                  ? 'indeterminate'
                                  : false
                        }
                        onCheckedChange={(value) =>
                            table.toggleAllRowsSelected(value === true)
                        }
                        disabled={busy}
                    />
                ),
                cell: ({ row }) => (
                    <Checkbox
                        aria-label={`Seleziona ${row.original.description}`}
                        checked={row.getIsSelected()}
                        onCheckedChange={(value) =>
                            row.toggleSelected(value === true)
                        }
                        disabled={busy}
                    />
                ),
            },
            {
                id: 'expand',
                header: () => <span className="sr-only">Dettagli</span>,
                enableHiding: false,
                cell: ({ row }) => (
                    <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Dettaglio ${row.original.description}`}
                        aria-controls={`budget-detail-${row.original.id}`}
                        aria-expanded={details.includes(row.original.id)}
                        onClick={() => toggleDetail(row.original.id)}
                    >
                        {details.includes(row.original.id) ? (
                            <ChevronDown />
                        ) : (
                            <ChevronRight />
                        )}
                    </Button>
                ),
            },
            {
                accessorKey: 'description',
                header: 'Descrizione',
                enableHiding: false,
                cell: ({ row }) => (
                    <div className="flex max-w-96 min-w-80 items-center gap-3 whitespace-normal">
                        <div className="flex min-w-0 flex-1 items-center gap-1">
                            <InlineEdit
                                value={row.original.description}
                                label={`Descrizione di ${row.original.description}`}
                                disabled={busy}
                                onSave={async (value) => {
                                    await onRecordSave(
                                        `${row.original.type}s`,
                                        row.original.source_id!,
                                        {
                                            [row.original.type === 'expense'
                                                ? 'title'
                                                : 'name']: value,
                                        },
                                    );
                                }}
                            />
                            {row.original.source_id !== null && (
                                <Button
                                    asChild
                                    variant="ghost"
                                    size="icon"
                                    className="shrink-0"
                                    disabled={busy || loading}
                                >
                                    <Link
                                        href={`/t/${slug}/${row.original.type}s/${row.original.source_id}`}
                                        aria-label={`Apri ${row.original.description}`}
                                    >
                                        <ArrowUpRight />
                                    </Link>
                                </Button>
                            )}
                            {row.original.estimated_count > 0 &&
                                completionLabel(row.original) && (
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="icon"
                                                className="size-6 shrink-0"
                                                disabled={busy || loading}
                                                aria-label={`${completionLabel(row.original)}: ${row.original.description}`}
                                                aria-controls={`budget-detail-${row.original.id}`}
                                                aria-expanded={details.includes(
                                                    row.original.id,
                                                )}
                                                onClick={() =>
                                                    openCompletion(
                                                        row.original.id,
                                                    )
                                                }
                                            >
                                                <TriangleAlert className="text-muted-foreground" />
                                            </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            {completionLabel(row.original)}
                                        </TooltipContent>
                                    </Tooltip>
                                )}
                        </div>
                        {((preferences.group === 'center' &&
                            preferences.visibility.type === false) ||
                            (row.original.type === 'expense' &&
                                row.original.expenses[0]?.contributes ===
                                    false)) && (
                            <div className="flex max-w-48 flex-col items-start gap-1">
                                {preferences.group === 'center' &&
                                    preferences.visibility.type === false && (
                                        <Badge
                                            variant="secondary"
                                            className="text-xs"
                                        >
                                            {budgetLabels[row.original.type]}
                                        </Badge>
                                    )}
                                {row.original.type === 'expense' &&
                                    row.original.expenses[0] && (
                                        <Attribution
                                            expense={row.original.expenses[0]}
                                        />
                                    )}
                            </div>
                        )}
                    </div>
                ),
            },
            {
                accessorKey: 'type',
                header: 'Tipo',
                cell: ({ row }) => (
                    <Badge variant="secondary">
                        {budgetLabels[row.original.type]}
                    </Badge>
                ),
            },
            {
                id: 'vendor',
                accessorFn: (row) =>
                    row.type === 'project'
                        ? '—'
                        : (row.vendor?.name ?? 'Senza fornitore'),
                header: 'Fornitore',
                cell: ({ row }) =>
                    row.original.type === 'project' ? (
                        '—'
                    ) : row.original.vendor ? (
                        <Link
                            href={`/t/${slug}/vendors/${row.original.vendor.id}`}
                            className="text-foreground"
                        >
                            {row.original.vendor.name}
                        </Link>
                    ) : (
                        'Senza fornitore'
                    ),
            },
            {
                id: 'center',
                accessorFn: (row) => String(row.cost_center_id ?? 'none'),
                sortingFn: (a, b) =>
                    (
                        a.original.cost_center?.name ?? 'Senza centro di costo'
                    ).localeCompare(
                        b.original.cost_center?.name ?? 'Senza centro di costo',
                        'it',
                    ),
                header: 'Centro di costo',
                cell: ({ row }) => (
                    <BudgetCenterSelect
                        centers={centers}
                        value={row.original.cost_center_id}
                        disabled={busy}
                        label={`Centro di costo di ${row.original.description}`}
                        onChange={(id) => {
                            void mutate('entries', 'PATCH', {
                                action: 'update',
                                ids: [row.original.id],
                                changes: { cost_center_id: id },
                            });
                        }}
                    />
                ),
            },
            ...(['allocated', 'actual'] as const).map(
                (field): ColumnDef<BudgetEntry> => ({
                    id: field,
                    accessorFn: (row) =>
                        row[field] === null ? undefined : Number(row[field]),
                    sortUndefined: 'last',
                    aggregationFn: (_column, rows) => {
                        const value = groupTotal(rows[0]?.original)?.[field];
                        return value == null ? undefined : Number(value);
                    },
                    header: columnNames[field],
                    cell: ({ row }) =>
                        row.original.type === 'expense' &&
                        row.original.source_id &&
                        row.original.expenses[0] ? (
                            <ExpenseAmount
                                value={row.original[field]}
                                busy={busy}
                                label={`Modifica ${columnNames[field]} della spesa ${row.original.description}`}
                                expense={row.original.expenses[0]}
                                highlightEstimate={
                                    completionTarget?.id === row.original.id &&
                                    row.original.estimated_count > 0
                                }
                                field={
                                    field === 'allocated'
                                        ? 'allocated_amount'
                                        : 'actual_amount'
                                }
                                onExpenseEdit={onExpenseEdit}
                                onRecordSave={onRecordSave}
                            />
                        ) : (
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-auto min-h-8 w-full justify-end financial-value tabular-nums"
                                        aria-label={`Mostra le spese di ${row.original.description}: ${columnNames[field]}`}
                                        aria-expanded={details.includes(
                                            row.original.id,
                                        )}
                                        onClick={() =>
                                            setDetails((current) =>
                                                current.includes(
                                                    row.original.id,
                                                )
                                                    ? current
                                                    : [
                                                          ...current,
                                                          row.original.id,
                                                      ],
                                            )
                                        }
                                    >
                                        {money(row.original[field], '')}
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    Mostra le spese che compongono il totale
                                </TooltipContent>
                            </Tooltip>
                        ),
                }),
            ),
            {
                id: 'variance',
                accessorFn: (row) =>
                    row.variance === null ? undefined : Number(row.variance),
                sortUndefined: 'last',
                header: 'Scostamento',
                aggregationFn: (_column, rows) => {
                    const value = groupTotal(rows[0]?.original)?.variance;
                    return value == null ? undefined : Number(value);
                },
                cell: ({ row }) => (
                    <span
                        className={cn(
                            'financial-value',
                            varianceTextClass(row.original.variance),
                        )}
                    >
                        {row.original.variance === null
                            ? 'Non confrontabile'
                            : money(row.original.variance)}
                    </span>
                ),
            },
            {
                id: 'actions',
                header: () => <span className="sr-only">Azioni</span>,
                enableHiding: false,
                cell: ({ row }) => {
                    const entry = row.original;
                    return (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    disabled={busy}
                                    aria-label={`Azioni per ${entry.description}`}
                                >
                                    <Ellipsis />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuGroup>
                                    {
                                        <DropdownMenuItem asChild>
                                            <Link
                                                href={`/t/${slug}/${entry.type}s/${entry.source_id}`}
                                            >
                                                Apri nell’archivio
                                            </Link>
                                        </DropdownMenuItem>
                                    }
                                    {entry.type === 'expense' && (
                                        <DropdownMenuItem
                                            onSelect={() => {
                                                onExpenseEdit(entry.source_id!);
                                            }}
                                        >
                                            Righe e collegamenti
                                        </DropdownMenuItem>
                                    )}

                                    <DropdownMenuItem
                                        variant="destructive"
                                        onSelect={() => setRemoving([entry.id])}
                                    >
                                        Rimuovi dal Budget
                                    </DropdownMenuItem>
                                </DropdownMenuGroup>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    );
                },
            },
        ],
        [
            budget.entries,
            busy,
            loading,
            centers,
            details,
            completionTarget,
            mutate,
            onExpenseEdit,
            slug,
            preferences.group,
            preferences.visibility.type,
            groupTotal,
            batch,
            toggleDetail,
            openCompletion,
            year,
        ],
    );
    const filtered = useMemo(
        () =>
            budget.entries.filter(
                (row) =>
                    (typeFilter === 'all' || row.type === typeFilter) &&
                    (vendor === 'all' ||
                        String(row.vendor?.id ?? 'none') === vendor) &&
                    (center === 'all' ||
                        String(row.cost_center_id ?? 'none') === center),
            ),
        [budget.entries, typeFilter, vendor, center],
    );
    const data = useMemo(
        () =>
            [...filtered].sort(
                (a, b) =>
                    (preferences.group === 'type'
                        ? budgetTypes.indexOf(a.type) -
                          budgetTypes.indexOf(b.type)
                        : (
                              a.cost_center?.name ?? 'Senza centro di costo'
                          ).localeCompare(
                              b.cost_center?.name ?? 'Senza centro di costo',
                              'it',
                          )) ||
                    a.position - b.position ||
                    a.id - b.id,
            ),
        [filtered, preferences.group],
    );
    const grouping = useMemo(() => [preferences.group], [preferences.group]);
    const table = useReactTable({
        data,
        columns,
        getRowId: (row) => String(row.id),
        groupedColumnMode: false,
        autoResetExpanded: false,
        autoResetPageIndex: false,
        state: {
            sorting,
            rowSelection: selection,
            expanded,
            globalFilter: search,
            grouping,
            columnVisibility: preferences.visibility,
            columnOrder: preferences.order,
        },
        onSortingChange: setSorting,
        onRowSelectionChange: setSelection,
        onExpandedChange: setExpanded,
        onColumnVisibilityChange: (value) =>
            changePreferences({
                ...preferences,
                visibility:
                    typeof value === 'function'
                        ? value(preferences.visibility)
                        : value,
            }),
        onColumnOrderChange: (value) =>
            changePreferences({
                ...preferences,
                order:
                    typeof value === 'function'
                        ? value(preferences.order)
                        : value,
            }),
        enableRowSelection: (row) => !row.getIsGrouped(),
        globalFilterFn: (row, _column, value: string) =>
            [
                row.original.description,
                row.original.vendor?.name,
                row.original.cost_center?.name,
                budgetLabels[row.original.type],
            ].some((text) =>
                text
                    ?.toLocaleLowerCase('it')
                    .includes(value.toLocaleLowerCase('it')),
            ),
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getGroupedRowModel: getGroupedRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getExpandedRowModel: getExpandedRowModel(),
    });
    const dragDisabled = busy || loading || sorting.length > 0;
    const dragDisabledReason =
        sorting.length > 0
            ? 'Ripristina ordine manuale per trascinare le voci'
            : 'Attendi il completamento del salvataggio o aggiornamento';
    const dragLabel = (id: string | number) =>
        budget.entries.find((entry) => String(entry.id) === String(id))
            ?.description ?? String(id);
    function finishDrag({ active, over }: DragEndEvent) {
        setDragging(false);
        if (dragDisabled || !over || active.id === over.id) return;
        const rows = table
            .getRowModel()
            .rows.filter((row) => !row.getIsGrouped());
        const source = rows.find((row) => row.id === active.id);
        const destination = rows.find((row) => row.id === over.id);
        if (!source || !destination || source.parentId !== destination.parentId)
            return;
        const visibleIds = rows
            .filter((row) => row.parentId === source.parentId)
            .map((row) => row.original.id);
        const moved = arrayMove(
            visibleIds,
            visibleIds.indexOf(source.original.id),
            visibleIds.indexOf(destination.original.id),
        );
        const visible = new Set(visibleIds);
        let index = 0;
        // Replace only the slots of visible group members; hidden entries and other groups keep their slots.
        const ids = [...budget.entries]
            .sort((a, b) => a.position - b.position || a.id - b.id)
            .map((entry) =>
                visible.has(entry.id) ? moved[index++] : entry.id,
            );
        void batch('reorder', ids);
    }
    function renderEntry(row: Row<BudgetEntry>) {
        const entry = row.original;
        const descriptionIndex = Math.max(
            0,
            visibleColumns.findIndex((column) => column.id === 'description'),
        );
        const highlightEstimate =
            completionTarget?.id === entry.id && entry.estimated_count > 0;
        return (
            <Fragment key={row.id}>
                <SortableBudgetRow
                    row={row}
                    disabled={dragDisabled}
                    disabledReason={dragDisabledReason}
                />
                {details.includes(entry.id) &&
                    (dragging ? (
                        // Retain the detail height while suspending its contents so drag targets do not jump.
                        <TableRow aria-hidden="true">
                            <TableCell
                                colSpan={visibleColumns.length}
                                className="p-0"
                                style={{ height: detailHeights[entry.id] ?? 0 }}
                            />
                        </TableRow>
                    ) : (
                        <>
                            {(entry.type === 'expense' ||
                                !entry.expenses.length) && (
                                <TableRow data-budget-detail-owner={entry.id}>
                                    {descriptionIndex > 0 && (
                                        <TableCell
                                            colSpan={descriptionIndex}
                                            className="bg-muted/20 p-0"
                                        />
                                    )}
                                    <TableCell
                                        colSpan={
                                            visibleColumns.length -
                                            descriptionIndex
                                        }
                                        className="bg-muted/20 px-2 py-3 whitespace-normal"
                                    >
                                        <div
                                            id={`budget-detail-${entry.id}`}
                                            tabIndex={-1}
                                            className="ml-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                                        >
                                            <EntryDetail
                                                entry={entry}
                                                slug={slug}
                                                year={year}
                                                busy={busy}
                                                highlightEstimate={
                                                    highlightEstimate
                                                }
                                                onExpenseEdit={onExpenseEdit}
                                            />
                                        </div>
                                    </TableCell>
                                </TableRow>
                            )}
                            {(entry.type === 'contract' ||
                                entry.type === 'project') && (
                                <ExpenseRows
                                    entry={entry}
                                    columnIds={visibleColumns.map(
                                        (column) => column.id,
                                    )}
                                    slug={slug}
                                    busy={busy}
                                    highlightEstimate={highlightEstimate}
                                    onExpenseEdit={onExpenseEdit}
                                    onRecordSave={onRecordSave}
                                />
                            )}
                        </>
                    ))}
            </Fragment>
        );
    }
    const selected = budget.entries
        .filter((entry) => selection[String(entry.id)])
        .map((entry) => entry.id);
    const visibleColumns = table.getVisibleLeafColumns();
    const summaryColumns = budgetSummaryColumns(visibleColumns);
    const entryIds = table
        .getFilteredRowModel()
        .flatRows.map((row) => row.original.id)
        .join(',');
    useEffect(() => {
        if (!hasFilters) return;
        let current = true;
        const timer = setTimeout(() => {
            void api<{ budget: BudgetSnapshot }>(
                `/t/${slug}/budget/years/${budgetYearId}?entry_ids=${entryIds}`,
            )
                .then((result) => {
                    if (current)
                        setFilteredBudget({
                            source: budget,
                            key: filterKey,
                            result: result.budget,
                        });
                })
                .catch((error: unknown) => {
                    if (current)
                        toast.error(
                            error instanceof Error
                                ? error.message
                                : 'Totali filtrati non disponibili.',
                        );
                });
        }, 150);
        return () => {
            current = false;
            clearTimeout(timer);
        };
    }, [budget, budgetYearId, entryIds, filterKey, hasFilters, slug]);
    const activeFilterCount = [
        !!search,
        typeFilter !== 'all',
        vendor !== 'all',
        center !== 'all',
    ].filter(Boolean).length;
    function footer(label: string, totals: typeof budget.totals) {
        return (
            <TableRow>
                {summaryColumns.map((column) => (
                    <TableCell
                        key={column.id}
                        colSpan={column.colSpan}
                        className={cn(
                            ['allocated', 'actual', 'variance'].includes(
                                column.id,
                            ) && 'text-right financial-value',
                            column.id === 'variance' &&
                                varianceTextClass(totals.variance),
                        )}
                    >
                        {column.id === 'description' ? (
                            <span className="whitespace-normal">
                                {label}
                                <span className="block text-xs text-muted-foreground">
                                    {totals.count} voci incluse
                                    {totals.estimated_count > 0 &&
                                        ` · ${totals.estimated_count} ${totals.estimated_count === 1 ? 'voce solo stima' : 'voci solo stima'}`}
                                    {(!table
                                        .getColumn('allocated')
                                        ?.getIsVisible() ||
                                        !table
                                            .getColumn('actual')
                                            ?.getIsVisible()) &&
                                        ` · Allocato ${money(totals.allocated)} · Effettivo ${money(totals.actual)}`}
                                </span>
                            </span>
                        ) : ['allocated', 'actual', 'variance'].includes(
                              column.id,
                          ) ? (
                            column.id === 'variance' &&
                            totals.variance === null ? (
                                'Non confrontabile'
                            ) : (
                                money(
                                    totals[
                                        column.id as
                                            | 'allocated'
                                            | 'actual'
                                            | 'variance'
                                    ],
                                )
                            )
                        ) : null}
                    </TableCell>
                ))}
            </TableRow>
        );
    }
    const columnSettings = (
        <TableColumnSettings disabled={busy} iconOnly>
            <TableColumnOrder
                disabled={busy}
                columns={preferences.order.map((id) => ({
                    id,
                    label: columnNames[id],
                    visible: table.getColumn(id)?.getIsVisible() ?? false,
                    canHide: table.getColumn(id)?.getCanHide() ?? false,
                }))}
                onVisibilityChange={(id, visible) =>
                    table.getColumn(id)?.toggleVisibility(visible)
                }
                onOrderChange={(ids) => table.setColumnOrder(ids)}
            />
            <FilterSelect
                label="Raggruppamento"
                value={preferences.group}
                onChange={(group) => {
                    changePreferences({
                        ...preferences,
                        group: group as Preferences['group'],
                    });
                    setExpanded(true);
                }}
                options={[
                    {
                        value: 'type',
                        label: 'Gruppi per tipologia',
                    },
                    {
                        value: 'center',
                        label: 'Gruppi per centro',
                    },
                ]}
            />
            <Button
                variant="outline"
                size="sm"
                onClick={() => {
                    changePreferences({
                        order: defaultOrder,
                        visibility: { type: false },
                        group: 'type',
                    });
                    setSorting([]);
                    setExpanded(true);
                }}
            >
                Ripristina configurazione
            </Button>
        </TableColumnSettings>
    );
    useImperativeHandle(ref, () => ({
        exportFilters: () => ({ year, entry_ids: entryIds }),
        printReport() {
            if (busy || loading || !summary) {
                toast.error(
                    'Il Budget non è pronto per la stampa. Attendi il caricamento dei totali o aggiorna il Budget.',
                );
                return;
            }
            try {
                setReport(
                    captureBudgetReport(table, summary, [
                        ...(search ? [`Ricerca: ${search}`] : []),
                        ...(typeFilter !== 'all'
                            ? [
                                  `Tipo: ${budgetLabels[typeFilter as BudgetType]}`,
                              ]
                            : []),
                        ...(vendor !== 'all'
                            ? [
                                  `Fornitore: ${vendors.find((item) => String(item.id) === vendor)?.name ?? 'Senza fornitore'}`,
                              ]
                            : []),
                        ...(center !== 'all'
                            ? [
                                  `Centro: ${centers.find((item) => String(item.id) === center)?.name ?? 'Senza centro di costo'}`,
                              ]
                            : []),
                    ]),
                );
            } catch (error) {
                toast.error(
                    error instanceof Error
                        ? error.message
                        : 'Report non disponibile.',
                );
            }
        },
    }));
    return (
        <section
            className="flex min-w-0 flex-col gap-4"
            aria-label="Voci del Budget"
            aria-busy={busy || loading}
        >
            {report && (
                <BudgetPrintDialog
                    data={report}
                    tenantName={tenantName}
                    logoUrl={logoUrl}
                    year={year}
                    onClose={() => setReport(null)}
                />
            )}
            <div className="flex flex-wrap items-center gap-2">
                <TableFilters
                    title="Filtri del Budget"
                    count={activeFilterCount}
                    disabled={busy}
                >
                    <FieldGroup className="gap-4">
                        <Field>
                            <FieldLabel htmlFor="budget-search">
                                Ricerca
                            </FieldLabel>
                            <InputGroup>
                                <InputGroupInput
                                    id="budget-search"
                                    aria-label="Cerca nelle voci del Budget"
                                    placeholder="Cerca nelle voci…"
                                    value={search}
                                    onChange={(event) => {
                                        setSearch(event.target.value);
                                        changeFilters({
                                            search: event.target.value,
                                        });
                                    }}
                                />
                            </InputGroup>
                        </Field>
                        <FilterSelect
                            label="Filtra per tipo"
                            value={typeFilter}
                            onChange={(type) => changeFilters({ type })}
                            options={[
                                {
                                    value: 'all',
                                    label: 'Tutte le tipologie',
                                },
                                ...budgetTypes.map((type) => ({
                                    value: type,
                                    label: budgetLabels[type],
                                })),
                            ]}
                        />
                        <FilterSelect
                            label="Filtra per fornitore"
                            value={vendor}
                            onChange={(vendor_id) =>
                                changeFilters({ vendor_id })
                            }
                            options={[
                                {
                                    value: 'all',
                                    label: 'Tutti i fornitori',
                                },
                                { value: 'none', label: 'Senza fornitore' },
                                ...vendors.map((v) => ({
                                    value: String(v.id),
                                    label: v.name,
                                })),
                            ]}
                        />
                        <FilterSelect
                            label="Filtra per centro di costo"
                            value={center}
                            onChange={(cost_center_id) =>
                                changeFilters({ cost_center_id })
                            }
                            options={[
                                { value: 'all', label: 'Tutti i centri' },
                                {
                                    value: 'none',
                                    label: 'Senza centro di costo',
                                },
                                ...centers.map((c) => ({
                                    value: String(c.id),
                                    label: c.name,
                                })),
                            ]}
                        />

                        {hasFilters && (
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => {
                                    setSearch('');
                                    changeFilters({
                                        search: '',
                                        type: 'all',
                                        vendor_id: 'all',
                                        cost_center_id: 'all',
                                    });
                                }}
                            >
                                Azzera filtri
                            </Button>
                        )}
                    </FieldGroup>
                </TableFilters>
                {budget.has_missing_entries && (
                    <Button
                        variant="outline"
                        onClick={onMissing}
                        disabled={busy}
                    >
                        Inserisci spese mancanti
                    </Button>
                )}
                {sorting.length > 0 && (
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSorting([])}
                    >
                        Ripristina ordine manuale
                    </Button>
                )}
                <Button
                    type="button"
                    className="w-full sm:ml-auto sm:w-auto"
                    onClick={onAdd}
                    disabled={busy}
                >
                    <Plus data-icon="inline-start" />
                    Aggiungi voce
                </Button>
            </div>
            {selected.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                    <span role="status">
                        {selected.length} voci selezionate
                    </span>

                    <Button
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => setRemoving(selected)}
                    >
                        Rimuovi dal Budget
                    </Button>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSelection({})}
                    >
                        Deseleziona
                    </Button>
                </div>
            )}
            {(busy || loading) && (
                <p role="status" className="sr-only">
                    {loading ? 'Aggiornamento…' : 'Salvataggio…'}
                </p>
            )}
            <DndContext
                id={dndId}
                sensors={sensors}
                collisionDetection={(args) =>
                    args.pointerCoordinates
                        ? pointerWithin(args)
                        : closestCenter(args)
                }
                accessibility={{
                    screenReaderInstructions: {
                        draggable:
                            'Premi Spazio o Invio per iniziare il riordino. Usa le frecce su e giù nel gruppo. Premi Spazio o Invio per confermare, Esc per annullare.',
                    },
                    announcements: {
                        onDragStart: ({ active }) =>
                            `Voce ${dragLabel(active.id)} selezionata.`,
                        onDragOver: ({ active, over }) => {
                            const source = table
                                .getRowModel()
                                .rows.find((row) => row.id === active.id);
                            const target = table
                                .getRowModel()
                                .rows.find((row) => row.id === over?.id);
                            return source &&
                                target &&
                                source.parentId === target.parentId
                                ? `${dragLabel(active.id)} sulla voce ${dragLabel(target.id)}.`
                                : 'Destinazione fuori dal gruppo: nessun riordino.';
                        },
                        onDragEnd: ({ active, over }) => {
                            const source = table
                                .getRowModel()
                                .rows.find((row) => row.id === active.id);
                            const target = table
                                .getRowModel()
                                .rows.find((row) => row.id === over?.id);
                            return source &&
                                target &&
                                source.id !== target.id &&
                                source.parentId === target.parentId
                                ? `Riordino di ${dragLabel(active.id)} inviato per il salvataggio.`
                                : 'Nessuna modifica all’ordine.';
                        },
                        onDragCancel: () => 'Riordino annullato.',
                    },
                }}
                onDragStart={() => {
                    const heights: Record<number, number> = {};
                    document
                        .querySelectorAll<HTMLElement>(
                            '[data-budget-detail-owner]',
                        )
                        .forEach((element) => {
                            const id = Number(
                                element.dataset.budgetDetailOwner,
                            );
                            heights[id] =
                                (heights[id] ?? 0) +
                                element.getBoundingClientRect().height;
                        });
                    setDetailHeights(heights);
                    setDragging(true);
                }}
                onDragCancel={() => setDragging(false)}
                onDragEnd={finishDrag}
            >
                <div className="min-w-0 overflow-hidden rounded-lg border bg-card">
                    <Table>
                        <TableHeader className="bg-muted [&_th]:font-semibold">
                            {table.getHeaderGroups().map((group) => (
                                <TableRow key={group.id}>
                                    {group.headers.map((header) => (
                                        <TableHead
                                            key={header.id}
                                            aria-sort={
                                                header.column.getIsSorted() ===
                                                'asc'
                                                    ? 'ascending'
                                                    : header.column.getIsSorted() ===
                                                        'desc'
                                                      ? 'descending'
                                                      : undefined
                                            }
                                            className={cn(
                                                [
                                                    'allocated',
                                                    'actual',
                                                    'variance',
                                                ].includes(header.column.id) &&
                                                    'text-right',
                                            )}
                                        >
                                            <div
                                                className={cn(
                                                    'flex items-center gap-1',
                                                    [
                                                        'allocated',
                                                        'actual',
                                                        'variance',
                                                    ].includes(
                                                        header.column.id,
                                                    ) && 'justify-end',
                                                )}
                                            >
                                                {header.column.id ===
                                                'actions' ? (
                                                    columnSettings
                                                ) : header.column.getCanSort() ? (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={header.column.getToggleSortingHandler()}
                                                    >
                                                        {flexRender(
                                                            header.column
                                                                .columnDef
                                                                .header,
                                                            header.getContext(),
                                                        )}
                                                        {header.column.getIsSorted() ===
                                                        'asc' ? (
                                                            <ArrowUp data-icon="inline-end" />
                                                        ) : header.column.getIsSorted() ===
                                                          'desc' ? (
                                                            <ArrowDown data-icon="inline-end" />
                                                        ) : null}
                                                    </Button>
                                                ) : (
                                                    flexRender(
                                                        header.column.columnDef
                                                            .header,
                                                        header.getContext(),
                                                    )
                                                )}
                                            </div>
                                        </TableHead>
                                    ))}
                                </TableRow>
                            ))}
                        </TableHeader>
                        <TableBody>
                            {!table.getRowModel().rows.length ? (
                                <TableRow>
                                    <TableCell colSpan={visibleColumns.length}>
                                        <Empty>
                                            {budget.entries.length ? (
                                                <EmptyHeader>
                                                    <EmptyTitle>
                                                        Nessuna voce corrisponde
                                                        ai filtri
                                                    </EmptyTitle>
                                                    <EmptyDescription>
                                                        Aggiungi contratti,
                                                        progetti, spese o voci
                                                        libere al Budget.
                                                    </EmptyDescription>
                                                </EmptyHeader>
                                            ) : (
                                                <Button
                                                    variant="outline"
                                                    disabled={busy}
                                                    onClick={onImport}
                                                >
                                                    Importa dall’anno precedente
                                                </Button>
                                            )}
                                        </Empty>
                                    </TableCell>
                                </TableRow>
                            ) : (
                                table.getSortedRowModel().rows.map((row) => {
                                    if (row.getIsGrouped()) {
                                        const value = String(
                                            row.getGroupingValue(
                                                preferences.group,
                                            ),
                                        );
                                        const title =
                                            preferences.group === 'type'
                                                ? budgetLabels[
                                                      value as BudgetType
                                                  ]
                                                : (centers.find(
                                                      (c) =>
                                                          String(c.id) ===
                                                          value,
                                                  )?.name ??
                                                  'Senza centro di costo');
                                        const totals = groupTotal(
                                            row.getLeafRows()[0]?.original,
                                        );
                                        return (
                                            <Fragment key={row.id}>
                                                <TableRow className="border-y bg-muted/60">
                                                    {summaryColumns.map(
                                                        (column) => (
                                                            <TableCell
                                                                key={column.id}
                                                                colSpan={
                                                                    column.colSpan
                                                                }
                                                                className={cn(
                                                                    column.id ===
                                                                        'description' &&
                                                                        'whitespace-normal',
                                                                    [
                                                                        'allocated',
                                                                        'actual',
                                                                        'variance',
                                                                    ].includes(
                                                                        column.id,
                                                                    ) &&
                                                                        'text-right financial-value tabular-nums',
                                                                    [
                                                                        'allocated',
                                                                        'actual',
                                                                    ].includes(
                                                                        column.id,
                                                                    ) && 'pr-5',
                                                                    column.id ===
                                                                        'variance' &&
                                                                        varianceTextClass(
                                                                            totals?.variance,
                                                                        ),
                                                                )}
                                                            >
                                                                {column.id ===
                                                                'description' ? (
                                                                    <div className="flex items-center gap-3">
                                                                        <Button
                                                                            size="sm"
                                                                            variant="ghost"
                                                                            className="h-auto min-h-9 max-w-full px-0 text-left whitespace-normal"
                                                                            aria-label={`${row.getIsExpanded() ? 'Comprimi' : 'Espandi'} ${title}`}
                                                                            aria-expanded={row.getIsExpanded()}
                                                                            onClick={row.getToggleExpandedHandler()}
                                                                        >
                                                                            <span className="font-semibold">
                                                                                {
                                                                                    title
                                                                                }{' '}
                                                                                ·{' '}
                                                                                {
                                                                                    row
                                                                                        .subRows
                                                                                        .length
                                                                                }
                                                                            </span>
                                                                            {row.getIsExpanded() ? (
                                                                                <ChevronDown />
                                                                            ) : (
                                                                                <ChevronRight />
                                                                            )}
                                                                        </Button>
                                                                        {totals &&
                                                                            totals.estimated_count >
                                                                                0 && (
                                                                                <Tooltip>
                                                                                    <TooltipTrigger
                                                                                        asChild
                                                                                    >
                                                                                        <span
                                                                                            role="img"
                                                                                            tabIndex={
                                                                                                0
                                                                                            }
                                                                                            aria-label={`${totals.estimated_count} ${totals.estimated_count === 1 ? 'voce solo stima' : 'voci solo stima'}`}
                                                                                            className="inline-flex shrink-0 text-muted-foreground"
                                                                                        >
                                                                                            <TriangleAlert className="size-4" />
                                                                                        </span>
                                                                                    </TooltipTrigger>
                                                                                    <TooltipContent>
                                                                                        {
                                                                                            totals.estimated_count
                                                                                        }{' '}
                                                                                        {totals.estimated_count ===
                                                                                        1
                                                                                            ? 'voce solo stima'
                                                                                            : 'voci solo stima'}
                                                                                    </TooltipContent>
                                                                                </Tooltip>
                                                                            )}
                                                                    </div>
                                                                ) : totals &&
                                                                  [
                                                                      'allocated',
                                                                      'actual',
                                                                      'variance',
                                                                  ].includes(
                                                                      column.id,
                                                                  ) ? (
                                                                    column.id ===
                                                                        'variance' &&
                                                                    totals.variance ===
                                                                        null ? (
                                                                        'Non confrontabile'
                                                                    ) : (
                                                                        money(
                                                                            totals[
                                                                                column.id as
                                                                                    | 'allocated'
                                                                                    | 'actual'
                                                                                    | 'variance'
                                                                            ],
                                                                        )
                                                                    )
                                                                ) : null}
                                                            </TableCell>
                                                        ),
                                                    )}
                                                </TableRow>
                                                {row.getIsExpanded() && (
                                                    <SortableContext
                                                        items={row.subRows.map(
                                                            (leaf) => leaf.id,
                                                        )}
                                                        strategy={
                                                            verticalListSortingStrategy
                                                        }
                                                    >
                                                        {row.subRows.map(
                                                            renderEntry,
                                                        )}
                                                    </SortableContext>
                                                )}
                                            </Fragment>
                                        );
                                    }
                                    return renderEntry(row);
                                })
                            )}
                        </TableBody>
                        <TableFooter>
                            {hasFilters &&
                                summary &&
                                footer(
                                    'Totale filtrato · voci incluse visibili',
                                    summary.totals,
                                )}
                            {footer('Totale generale annuale', budget.totals)}
                        </TableFooter>
                    </Table>
                </div>
            </DndContext>
            <AlertDialog
                open={removing.length > 0}
                onOpenChange={(open) => {
                    if (!open && !busy) setRemoving([]);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogCancel
                        className="absolute top-2 right-2"
                        variant="ghost"
                        size="icon"
                        aria-label="Chiudi"
                        disabled={busy}
                    >
                        <X aria-hidden="true" />
                    </AlertDialogCancel>
                    <AlertDialogHeader>
                        <AlertDialogTitle className="pr-8">
                            Rimuovere {removing.length}{' '}
                            {removing.length === 1 ? 'voce' : 'voci'} dal
                            Budget?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Verranno rimossi i riferimenti annuali selezionati.
                            Puoi conservare la spesa nell’archivio oppure
                            eliminarla se non è usata altrove. Contratti e
                            progetti rimangono negli archivi.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter className="min-w-0 flex-col flex-wrap *:h-auto *:min-h-9 *:whitespace-normal">
                        <AlertDialogAction
                            disabled={busy}
                            variant="destructive"
                            onClick={(event) => {
                                event.preventDefault();
                                void batch('remove', removing).then((ok) => {
                                    if (ok) {
                                        setRemoving([]);
                                        setSelection({});
                                    }
                                });
                            }}
                        >
                            Rimuovi solo dal Budget
                        </AlertDialogAction>
                        {removing.length === 1 &&
                            budget.entries.find(
                                (entry) => entry.id === removing[0],
                            )?.type === 'expense' && (
                                <AlertDialogAction
                                    disabled={busy}
                                    variant="destructive"
                                    onClick={(event) => {
                                        event.preventDefault();
                                        void batch(
                                            'delete_expense',
                                            removing,
                                        ).then((ok) => {
                                            if (ok) {
                                                setRemoving([]);
                                                setSelection({});
                                            }
                                        });
                                    }}
                                >
                                    Elimina anche la spesa
                                </AlertDialogAction>
                            )}
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </section>
    );
}
