import { InlineEdit, saveInlineRecord } from './inline-edit';
import { useDelayedBusy } from '@/hooks/use-delayed-busy';
import { Link, router, usePage } from '@inertiajs/react';
import { ArrowUpRight, Ellipsis } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTableView, TableViewHeader, TableViewCells } from './table-view';
import { toast } from 'sonner';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { costCenterLabel } from './cost-center-tags';
import { CostCenterSelect } from './cost-center-select';
import { RecordSelect } from './record-select';
import { api, decimalInput, money, varianceTextClass } from './helpers';
import type {
    DeletionResult,
    Expense,
    Filters,
    Options,
    Catalog,
} from './types';

type AmountField = 'allocated_amount' | 'actual_amount';
const amountLabels = {
    allocated_amount: 'Allocato',
    actual_amount: 'Effettivo',
};

export function ExpenseTable({
    rows,
    loading = false,
    slug,
    showYear = false,
    options,
    hideRelations = [],
    contractMode = false,
    filters,
    onSort,
    onBusyChange,
    toolbar,
    projectId,
}: {
    rows: Expense[];
    loading?: boolean;
    slug: string;
    showYear?: boolean;
    options: Options;
    hideRelations?: Catalog[];
    contractMode?: boolean;
    filters?: Filters;
    onSort?: (field: string) => void;
    onBusyChange?: (busy: boolean) => void;
    toolbar?: ReactNode;
    projectId?: number;
}) {
    'use no memo'; // TanStack v8 exposes mutable table and column instances.

    const { url } = usePage();
    const scope = JSON.stringify([slug, url, rows.map((row) => row.id)]);
    const [previousScope, setPreviousScope] = useState(scope);
    const [selected, setSelected] = useState<number[]>([]);
    const [deleting, setDeleting] = useState<number[]>([]);
    const [unlinking, setUnlinking] = useState<number[]>([]);
    const [busy, setBusy] = useState(false);
    const visibleLoading = useDelayedBusy(loading);
    const [error, setError] = useState('');
    const lock = useRef(false);
    const refreshing = useRef(false);
    if (previousScope !== scope) {
        setPreviousScope(scope);
        setSelected([]);
        setDeleting([]);
        setUnlinking([]);
        setError('');
    }

    useEffect(() => {
        const stop = router.on('before', (event) => {
            if (refreshing.current) {
                refreshing.current = false;
                return;
            }
            if (lock.current) {
                event.preventDefault();
                toast.info('Attendi il completamento dell’operazione.');
            }
        });
        const leave = (event: BeforeUnloadEvent) => {
            if (lock.current) event.preventDefault();
        };
        window.addEventListener('beforeunload', leave);
        return () => {
            stop();
            window.removeEventListener('beforeunload', leave);
        };
    }, []);

    async function mutate(unlink = false) {
        if (lock.current) return;
        const ids = unlink ? unlinking : deleting;
        lock.current = true;
        setBusy(true);
        onBusyChange?.(true);
        setError('');
        let persisted = false;
        try {
            const result = unlink
                ? await api<DeletionResult>(
                      `/t/${slug}/expenses/batch`,
                      'PATCH',
                      {
                          updates: ids.map((id) => ({ id, project_id: null })),
                      },
                  )
                : await api<DeletionResult>(
                      `/t/${slug}/expenses/batch`,
                      'DELETE',
                      { ids },
                  );
            setDeleting([]);
            setUnlinking([]);
            setSelected([]);
            persisted = true;
            refreshing.current = true;
            const pageNumber = Number(
                new URL(url, window.location.origin).searchParams.get('page') ??
                    1,
            );
            await new Promise<void>((resolve, reject) => {
                let refreshed = false;
                router.reload({
                    ...(rows.every((row) => ids.includes(row.id)) &&
                    pageNumber > 1
                        ? { data: { page: pageNumber - 1 } }
                        : {}),
                    onSuccess: () => {
                        refreshed = true;
                        resolve();
                    },
                    onFinish: () => {
                        if (!refreshed)
                            reject(
                                new Error(
                                    'Aggiornamento della pagina non riuscito.',
                                ),
                            );
                    },
                    onHttpException: () => false,
                    onNetworkError: () => false,
                });
            });
            if (result.cleanup_failed) {
                toast.error(result.message);
            } else
                toast.success(
                    unlink ? 'Spese scollegate dal progetto.' : result.message,
                );
        } catch (failure) {
            const message =
                failure instanceof Error
                    ? failure.message
                    : 'Operazione non riuscita.';
            const detail = persisted
                ? 'Operazione completata sul server, ma i dati visualizzati non sono aggiornati. Ricarica la pagina prima di continuare.'
                : `${message} ${unlink ? 'Scollegamento' : 'Eliminazione'} non confermato. La selezione è conservata.`;
            if (persisted) toast.error(detail);
            else setError(detail);
        } finally {
            lock.current = false;
            refreshing.current = false;
            setBusy(false);
            onBusyChange?.(false);
        }
    }

    function amount(expense: Expense, field: AmountField) {
        return expense.lines?.length ? (
            <Link
                href={`/t/${slug}/expenses/${expense.id}`}
                title="Importo calcolato dalle righe economiche"
                className="block min-h-5 financial-value"
                aria-label={
                    expense[field] == null
                        ? `${amountLabels[field]} per ${expense.title}`
                        : undefined
                }
            >
                {money(expense[field], '')}
            </Link>
        ) : (
            <InlineEdit
                value={expense[field]}
                label={`${amountLabels[field]} per ${expense.title}`}
                disabled={busy}
                className="min-h-5 text-right financial-value"
                display={money(expense[field], '')}
                onSave={(value) =>
                    saveInlineRecord(`/t/${slug}/expenses/${expense.id}`, {
                        [field]: decimalInput(value),
                    })
                }
            />
        );
    }

    const allSelected =
        rows.length > 0 && rows.every((row) => selected.includes(row.id));
    const view = useTableView<Expense>({
        rows,
        storageKey: `mp3:table:v1:${slug}:${contractMode ? 'contract-expenses' : 'expenses'}`,
        ...(onSort
            ? {
                  sorting: [
                      {
                          id: filters?.sort ?? 'title',
                          desc: filters?.direction === 'desc',
                      },
                  ],
                  onSortingChange: (sorting) => {
                      if (sorting[0]) onSort(sorting[0].id);
                  },
              }
            : {}),
        columns: [
            {
                id: 'select',
                label: 'Selezione',
                canHide: false,
                className: 'w-10',
                header: (
                    <Checkbox
                        aria-label="Seleziona tutte le spese della pagina"
                        disabled={busy || !rows.length}
                        checked={
                            allSelected
                                ? true
                                : selected.length
                                  ? 'indeterminate'
                                  : false
                        }
                        onCheckedChange={(checked) =>
                            setSelected(
                                checked === true
                                    ? [...new Set(rows.map((row) => row.id))]
                                    : [],
                            )
                        }
                    />
                ),
            },
            {
                id: 'title',
                label: 'Descrizione',
                canHide: false,
                value: (row) => row.title,
            },
            ...(!hideRelations.includes('vendors')
                ? [{ id: 'vendor_id', label: 'Fornitore' }]
                : []),
            { id: 'cost_center_ids', label: 'Centro di costo' },
            ...(!hideRelations.includes('projects')
                ? [{ id: 'project_id', label: 'Progetto' }]
                : []),
            ...(!hideRelations.includes('contracts')
                ? [{ id: 'contract_id', label: 'Contratto' }]
                : []),
            ...(contractMode
                ? [
                      {
                          id: 'year',
                          label: 'Anno di imputazione',
                          value: (row: Expense) => row.year,
                      },
                  ]
                : showYear
                  ? [
                        {
                            id: 'year',
                            label: 'Anno di imputazione',
                            value: (row: Expense) => row.year,
                        },
                    ]
                  : []),
            {
                id: 'allocated_amount',
                label: 'Allocato',
                value: (row) =>
                    row.allocated_amount == null
                        ? undefined
                        : Number(row.allocated_amount),
                className: 'text-right',
            },
            {
                id: 'actual_amount',
                label: 'Effettivo',
                value: (row) =>
                    row.actual_amount == null
                        ? undefined
                        : Number(row.actual_amount),
                className: 'text-right',
            },
            ...(!contractMode
                ? [
                      {
                          id: 'variance',
                          label: 'Scostamento',
                          value: onSort
                              ? undefined
                              : (row: Expense) =>
                                    row.variance == null
                                        ? undefined
                                        : Number(row.variance),
                          className: 'text-right',
                      },
                  ]
                : []),
            {
                id: 'actions',
                label: 'Azioni',
                className: 'w-10 text-right',
                canHide: false,
                header: <span className="sr-only">Azioni</span>,
            },
        ],
    });
    const amountCell = 'text-right tabular-nums';

    return (
        <div
            className="@container/expense-table flex min-w-0 flex-col gap-3"
            aria-busy={busy || loading}
        >
            {toolbar && (
                <div className="flex flex-wrap items-center gap-2">
                    {toolbar}
                </div>
            )}
            {selected.length > 0 && (
                <div
                    className="flex flex-wrap items-center gap-2 rounded-lg border border-primary/20 bg-accent px-4 py-3 text-sm"
                    aria-label="Azioni sulle spese selezionate"
                >
                    <span role="status" className="mr-auto">
                        {selected.length}{' '}
                        {selected.length === 1
                            ? 'spesa selezionata'
                            : 'spese selezionate'}
                    </span>
                    <Button
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        onClick={() => setSelected([])}
                    >
                        Deseleziona tutto
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive"
                        disabled={busy}
                        onClick={() => setDeleting([...selected])}
                    >
                        Elimina selezionate
                    </Button>
                    {projectId && (
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            onClick={() => setUnlinking([...selected])}
                        >
                            Scollega dal progetto
                        </Button>
                    )}
                </div>
            )}
            <p role="status" className="min-h-5 text-sm text-muted-foreground">
                {busy
                    ? 'Operazione in corso…'
                    : visibleLoading
                      ? 'Aggiornamento delle spese…'
                      : ''}
            </p>
            <div className="min-w-0 overflow-hidden rounded-lg border bg-card">
                <Table>
                    <TableViewHeader view={view} disabled={busy || loading} />
                    <TableBody>
                        {!rows.length && (
                            <TableRow>
                                <TableCell
                                    colSpan={
                                        view.table.getVisibleLeafColumns()
                                            .length
                                    }
                                    className="py-10 text-center whitespace-normal text-muted-foreground"
                                >
                                    {filters?.search
                                        ? 'Nessun risultato per la ricerca'
                                        : 'Nessuna spesa in questo perimetro. Aggiungi una spesa oppure modifica i filtri.'}
                                </TableCell>
                            </TableRow>
                        )}
                        {view.table
                            .getRowModel()
                            .rows.map(({ original: expense }) => (
                                <TableRow
                                    key={`${expense.id}:${expense.year}`}
                                    data-state={
                                        selected.includes(expense.id)
                                            ? 'selected'
                                            : undefined
                                    }
                                    className="hover:bg-muted/50 data-[state=selected]:bg-accent"
                                >
                                    <TableViewCells table={view.table}>
                                        <TableCell key="select">
                                            <Checkbox
                                                aria-label={`Seleziona ${expense.title}`}
                                                checked={selected.includes(
                                                    expense.id,
                                                )}
                                                disabled={busy}
                                                onCheckedChange={(checked) =>
                                                    setSelected((previous) =>
                                                        checked === true
                                                            ? [
                                                                  ...previous,
                                                                  expense.id,
                                                              ]
                                                            : previous.filter(
                                                                  (id) =>
                                                                      id !==
                                                                      expense.id,
                                                              ),
                                                    )
                                                }
                                            />
                                        </TableCell>
                                        <TableCell
                                            key="title"
                                            className="min-w-56 whitespace-normal"
                                        >
                                            <div className="flex items-center gap-2">
                                                <InlineEdit
                                                    value={expense.title}
                                                    label={`Titolo di ${expense.title}`}
                                                    disabled={busy}
                                                    className="flex-1 font-medium break-words"
                                                    onSave={(value) =>
                                                        saveInlineRecord(
                                                            `/t/${slug}/expenses/${expense.id}`,
                                                            { title: value },
                                                        )
                                                    }
                                                />
                                                <Button
                                                    asChild
                                                    variant="ghost"
                                                    size="icon"
                                                    disabled={busy}
                                                >
                                                    <Link
                                                        href={`/t/${slug}/expenses/${expense.id}`}
                                                        aria-label={`Apri ${expense.title}`}
                                                    >
                                                        <ArrowUpRight />
                                                    </Link>
                                                </Button>
                                            </div>
                                        </TableCell>
                                        {(
                                            [
                                                'vendors',
                                                'cost_centers',
                                                'projects',
                                                'contracts',
                                            ] as const
                                        ).map((catalog) => {
                                            if (
                                                catalog !== 'cost_centers' &&
                                                hideRelations.includes(catalog)
                                            )
                                                return null;
                                            const relation =
                                                catalog === 'vendors'
                                                    ? 'vendor'
                                                    : catalog === 'projects'
                                                      ? 'project'
                                                      : 'contract';
                                            const multiple =
                                                catalog === 'cost_centers';
                                            const key = multiple
                                                ? 'cost_center_ids'
                                                : (`${relation}_id` as const);
                                            const current = expense[relation];
                                            const display = multiple
                                                ? expense.cost_centers
                                                      ?.map(costCenterLabel)
                                                      .join(', ')
                                                : (current?.display_name ??
                                                  current?.name);
                                            const label = multiple
                                                ? 'Centro di costo'
                                                : catalog === 'vendors'
                                                  ? 'Fornitore'
                                                  : catalog === 'projects'
                                                    ? 'Progetto'
                                                    : 'Contratto';
                                            return (
                                                <TableCell
                                                    key={key}
                                                    className="min-w-40 whitespace-normal"
                                                >
                                                    <InlineEdit
                                                        value={
                                                            multiple
                                                                ? JSON.stringify(
                                                                      expense.cost_centers?.map(
                                                                          (
                                                                              center,
                                                                          ) =>
                                                                              center.id,
                                                                      ) ?? [],
                                                                  )
                                                                : expense[
                                                                        `${relation}_id`
                                                                    ] == null
                                                                  ? ''
                                                                  : String(
                                                                        expense[
                                                                            `${relation}_id`
                                                                        ],
                                                                    )
                                                        }
                                                        label={`${label} di ${expense.title}`}
                                                        disabled={
                                                            busy || loading
                                                        }
                                                        display={
                                                            <span
                                                                className={
                                                                    !display
                                                                        ? 'text-muted-foreground'
                                                                        : undefined
                                                                }
                                                            >
                                                                {display ||
                                                                    'Non assegnato'}
                                                            </span>
                                                        }
                                                        renderEditor={({
                                                            value,
                                                            onChange,
                                                            disabled,
                                                            invalid,
                                                        }) =>
                                                            multiple ? (
                                                                <CostCenterSelect
                                                                    id={`expense-${expense.id}-${expense.year}-centers`}
                                                                    options={
                                                                        options.cost_centers
                                                                    }
                                                                    value={
                                                                        JSON.parse(
                                                                            value,
                                                                        ) as number[]
                                                                    }
                                                                    onChange={(
                                                                        ids,
                                                                    ) =>
                                                                        onChange(
                                                                            JSON.stringify(
                                                                                ids,
                                                                            ),
                                                                        )
                                                                    }
                                                                    disabled={
                                                                        disabled
                                                                    }
                                                                    invalid={
                                                                        invalid
                                                                    }
                                                                />
                                                            ) : (
                                                                <RecordSelect
                                                                    slug={slug}
                                                                    catalog={
                                                                        catalog as Catalog
                                                                    }
                                                                    value={
                                                                        value
                                                                    }
                                                                    onChange={
                                                                        onChange
                                                                    }
                                                                    options={[
                                                                        ...options[
                                                                            catalog as Catalog
                                                                        ],
                                                                        ...(current
                                                                            ? [
                                                                                  current,
                                                                              ]
                                                                            : []),
                                                                    ]}
                                                                    label={
                                                                        label
                                                                    }
                                                                    disabled={
                                                                        disabled
                                                                    }
                                                                    aria-invalid={
                                                                        invalid
                                                                    }
                                                                />
                                                            )
                                                        }
                                                        onSave={(value) =>
                                                            saveInlineRecord(
                                                                `/t/${slug}/expenses/${expense.id}`,
                                                                {
                                                                    [key]: multiple
                                                                        ? (JSON.parse(
                                                                              value,
                                                                          ) as number[])
                                                                        : value
                                                                          ? Number(
                                                                                value,
                                                                            )
                                                                          : null,
                                                                },
                                                            )
                                                        }
                                                    />
                                                </TableCell>
                                            );
                                        })}
                                        {showYear && !contractMode && (
                                            <TableCell key="year">
                                                {expense.year}
                                            </TableCell>
                                        )}
                                        {contractMode && (
                                            <>
                                                <TableCell
                                                    key="year"
                                                    className={amountCell}
                                                >
                                                    {[
                                                        ...new Set(
                                                            expense.lines?.map(
                                                                (line) =>
                                                                    line.year ??
                                                                    expense.year,
                                                            ) ?? [expense.year],
                                                        ),
                                                    ]
                                                        .sort(
                                                            (left, right) =>
                                                                Number(left) -
                                                                Number(right),
                                                        )
                                                        .join(', ') ||
                                                        expense.year}
                                                </TableCell>
                                            </>
                                        )}
                                        <TableCell
                                            key="allocated_amount"
                                            className={amountCell}
                                        >
                                            {amount(
                                                expense,
                                                'allocated_amount',
                                            )}
                                        </TableCell>
                                        <TableCell
                                            key="actual_amount"
                                            className={amountCell}
                                        >
                                            {amount(expense, 'actual_amount')}
                                        </TableCell>
                                        {!contractMode && (
                                            <TableCell
                                                key="variance"
                                                className={cn(
                                                    amountCell,
                                                    'text-sm font-medium tabular-nums',
                                                    varianceTextClass(
                                                        expense.variance,
                                                    ),
                                                )}
                                            >
                                                <span className="tracking-normal whitespace-nowrap">
                                                    {expense.variance == null
                                                        ? 'Non determinabile'
                                                        : money(
                                                              expense.variance,
                                                          )}
                                                </span>
                                            </TableCell>
                                        )}
                                        <TableCell
                                            key="actions"
                                            className="text-right"
                                        >
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <Button
                                                        variant="ghost"
                                                        size="icon"
                                                        aria-label={`Azioni per ${expense.title}`}
                                                        disabled={busy}
                                                    >
                                                        <Ellipsis className="size-4" />
                                                    </Button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end">
                                                    <DropdownMenuGroup>
                                                        <DropdownMenuItem
                                                            asChild
                                                        >
                                                            <Link
                                                                href={`/t/${slug}/expenses/${expense.id}`}
                                                            >
                                                                Apri dettaglio
                                                            </Link>
                                                        </DropdownMenuItem>
                                                        <DropdownMenuItem
                                                            asChild
                                                        >
                                                            <Link
                                                                href={`/t/${slug}/expenses/${expense.id}/edit`}
                                                            >
                                                                Gestisci righe e
                                                                collegamenti
                                                            </Link>
                                                        </DropdownMenuItem>
                                                        <DropdownMenuSeparator />
                                                        {projectId && (
                                                            <DropdownMenuItem
                                                                onSelect={() =>
                                                                    setUnlinking(
                                                                        [
                                                                            expense.id,
                                                                        ],
                                                                    )
                                                                }
                                                            >
                                                                Scollega dal
                                                                progetto
                                                            </DropdownMenuItem>
                                                        )}
                                                        <DropdownMenuItem
                                                            variant="destructive"
                                                            onSelect={() =>
                                                                setDeleting([
                                                                    expense.id,
                                                                ])
                                                            }
                                                        >
                                                            Elimina
                                                        </DropdownMenuItem>
                                                    </DropdownMenuGroup>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </TableCell>
                                    </TableViewCells>
                                </TableRow>
                            ))}
                    </TableBody>
                </Table>
            </div>
            <AlertDialog
                open={deleting.length > 0}
                onOpenChange={(open) => {
                    if (!open && !busy) {
                        setDeleting([]);
                        setError('');
                    }
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Eliminare{' '}
                            {deleting.length === 1
                                ? 'questa spesa'
                                : `${deleting.length} spese`}
                            ?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Le spese selezionate verranno eliminate. Puoi
                            annullare l’eliminazione con Ctrl+Z.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {error && (
                        <p role="alert" className="text-sm text-destructive">
                            {error}
                        </p>
                    )}
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={busy}>
                            Annulla
                        </AlertDialogCancel>
                        <AlertDialogAction
                            variant="destructive"
                            disabled={busy}
                            onClick={(event) => {
                                event.preventDefault();
                                void mutate();
                            }}
                        >
                            {busy ? 'Eliminazione…' : 'Elimina'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            <AlertDialog
                open={unlinking.length > 0}
                onOpenChange={(open) => {
                    if (!open && !busy) {
                        setUnlinking([]);
                        setError('');
                    }
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            Scollegare{' '}
                            {unlinking.length === 1
                                ? 'questa spesa'
                                : `${unlinking.length} spese`}{' '}
                            dal progetto?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            Le spese resteranno disponibili nella pagina Spese,
                            con i loro importi e allegati. Puoi annullare lo
                            scollegamento con Ctrl+Z.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {error && (
                        <p role="alert" className="text-sm text-destructive">
                            {error}
                        </p>
                    )}
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={busy}>
                            Annulla
                        </AlertDialogCancel>
                        <AlertDialogAction
                            disabled={busy}
                            onClick={(event) => {
                                event.preventDefault();
                                void mutate(true);
                            }}
                        >
                            {busy ? 'Scollegamento…' : 'Scollega'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}
