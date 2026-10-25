import { InlineEdit } from './inline-edit';
import { usePage } from '@inertiajs/react';
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { CellError } from './cell-error';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
    NativeSelect,
    NativeSelectOption,
} from '@/components/ui/native-select';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { decimalInput, money, varianceTextClass } from './helpers';
import { MoneyField, MoneyOutput } from './money-field';
import { ExpensePeriodFields } from './expense-period-fields';
import type { ExpenseLine, RecordData } from './types';
import {
    useTableView,
    TableFilters,
    TableViewHeader,
    TableViewCells,
} from './table-view';

export type DraftLine = ExpenseLine & { key: string; yearEdited?: boolean };

let nextLineKey = 0;
function lineKey(): string {
    return `expense-line-${++nextLineKey}`;
}

export function emptyDraftLine(
    type: ExpenseLine['type'] = 'allocated',
    description = '',
): DraftLine {
    return {
        key: lineKey(),
        description,
        type,
        quantity: '1',
        unit_price: '',
    };
}

export function draftLines(record?: RecordData): DraftLine[] {
    // An explicitly empty list must not turn calculated totals into draft lines.
    const lines =
        record?.lines !== undefined
            ? record.lines
            : (['allocated', 'actual'] as const).flatMap((type) => {
                  const amount =
                      record?.[
                          type === 'allocated'
                              ? 'allocated_amount'
                              : 'actual_amount'
                      ];
                  return amount == null
                      ? []
                      : [
                            {
                                description: record?.title ?? '',
                                type,
                                unit_price: amount,
                                quantity: '1',
                                period_starts_on: record?.period_starts_on,
                                period_ends_on: record?.period_ends_on,
                                year: record?.year,
                            },
                        ];
              });
    return lines.map((line) => ({
        ...line,
        key: lineKey(),
    }));
}

// Integer arithmetic mirrors the server: round each price × quantity to cents.
export function lineCents(line: ExpenseLine): bigint | null {
    const price = decimalInput(line.unit_price) ?? '';
    const quantity = decimalInput(line.quantity) ?? '';
    if (
        !/^-?\d{1,12}(\.\d{1,2})?$/.test(price) ||
        !/^\d{1,6}(\.\d{1,4})?$/.test(quantity)
    )
        return null;
    const [whole, fraction = ''] = price.replace('-', '').split('.');
    const [units, partial = ''] = quantity.split('.');
    const scaled = BigInt(units) * 10000n + BigInt(partial.padEnd(4, '0'));
    if (scaled === 0n) return null;
    const product =
        (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))) * scaled;
    return ((product + 5000n) / 10000n) * (price.startsWith('-') ? -1n : 1n);
}

export function ExpenseLines({
    lines,
    preservedAmounts,
    onChange,
    onSaveLine,
    disabled = false,
    readOnly = false,
    showSummary = true,
    showHeading = true,
    showFilters = true,
    contractMode = false,
    defaultDescription = '',
    defaultPeriod,
    initialFocusKey,
    errors = {},
}: {
    lines: DraftLine[];
    preservedAmounts?: Pick<RecordData, 'allocated_amount' | 'actual_amount'>;
    onChange?: (lines: DraftLine[]) => void;
    onSaveLine?: (
        key: string,
        field: keyof ExpenseLine,
        value: string,
    ) => Promise<void>;
    disabled?: boolean;
    readOnly?: boolean;
    showSummary?: boolean;
    showHeading?: boolean;
    showFilters?: boolean;
    contractMode?: boolean;
    defaultDescription?: string;
    defaultPeriod?: Record<string, string>;
    initialFocusKey?: string;
    errors?: Record<string, string[]>;
}) {
    'use no memo'; // TanStack v8 exposes mutable table and column instances.

    const { economicContext, currentTenant } = usePage().props;
    const [search, setSearch] = useState('');
    const [filter, setFilter] = useState('all');
    const [selected, setSelected] = useState<string[]>([]);
    const pendingFocus = useRef<string | null>(initialFocusKey ?? null);
    const errorId = useId();
    const fields = useRef<HTMLElement>(null);
    const errorSignature = JSON.stringify(errors);
    useEffect(() => {
        if (!disabled && errorSignature !== '{}') {
            fields.current
                ?.querySelector<HTMLElement>('[aria-invalid="true"]')
                ?.focus();
        }
    }, [disabled, errorSignature]);
    const visible = lines.filter(
        (line) =>
            (filter === 'all' || line.type === filter) &&
            line.description
                .toLocaleLowerCase('it')
                .includes(search.toLocaleLowerCase('it')),
    );
    const selectedLines = lines.filter((line) => selected.includes(line.key));
    const visibleSelected = visible.filter((line) =>
        selected.includes(line.key),
    ).length;
    const filtered = filter !== 'all' || search !== '';
    const totals: Record<ExpenseLine['type'], bigint | null> = {
        allocated: null,
        actual: null,
    };
    if (preservedAmounts) {
        for (const type of ['allocated', 'actual'] as const) {
            const amount = preservedAmounts[`${type}_amount`];
            if (amount != null) {
                totals[type] = lineCents({
                    type,
                    description: '',
                    unit_price: amount,
                    quantity: '1',
                });
            }
        }
    }
    const incomplete = new Set<ExpenseLine['type']>();
    for (const line of lines) {
        const cents = lineCents(line);
        if (cents === null) incomplete.add(line.type);
        else totals[line.type] = (totals[line.type] ?? 0n) + cents;
    }
    for (const type of ['allocated', 'actual'] as const) {
        if (contractMode ? incomplete.has(type) : incomplete.size > 0)
            totals[type] = null;
    }
    const variance =
        incomplete.size > 0
            ? null
            : (totals.actual ?? 0n) - (totals.allocated ?? 0n);
    const allocatedLabel = 'Allocato';
    const view = useTableView<DraftLine>({
        rows: visible,
        storageKey: `mp3:table:v1:${currentTenant?.slug}:expense-lines:${contractMode ? 'contract' : 'ordinary'}:${readOnly ? 'read' : 'edit'}`,
        columns: [
            ...(!readOnly
                ? [
                      {
                          id: 'select',
                          label: 'Selezione',
                          canHide: false,
                          className: 'w-10',
                          header: (
                              <Checkbox
                                  aria-label={
                                      'Seleziona tutte le righe visibili'
                                  }
                                  disabled={disabled || !visible.length}
                                  checked={
                                      visibleSelected === visible.length &&
                                      visible.length > 0
                                          ? true
                                          : visibleSelected > 0
                                            ? 'indeterminate'
                                            : false
                                  }
                                  onCheckedChange={(checked) =>
                                      setSelected((previous) =>
                                          checked === true
                                              ? [
                                                    ...new Set([
                                                        ...previous,
                                                        ...visible.map(
                                                            (line) => line.key,
                                                        ),
                                                    ]),
                                                ]
                                              : previous.filter(
                                                    (key) =>
                                                        !visible.some(
                                                            (line) =>
                                                                line.key ===
                                                                key,
                                                        ),
                                                ),
                                      )
                                  }
                              />
                          ),
                      },
                      { id: 'order', label: 'Ordine' },
                  ]
                : []),
            { id: 'type', label: 'Tipo', value: (line) => line.type },
            {
                id: 'description',
                label: 'Descrizione',
                value: (line) => line.description,
                canHide: false,
            },
            {
                id: 'unit_price',
                label: 'Prezzo unitario',
                value: (line) => Number(decimalInput(line.unit_price)),
                className: 'w-32 text-right',
            },
            {
                id: 'quantity',
                label: 'Quantità',
                value: (line) => Number(decimalInput(line.quantity)),
                className: 'w-24 text-right',
            },
            {
                id: 'total',
                label: 'Totale',
                value: (line) => lineCents(line) ?? undefined,
                className: 'text-right',
            },
            {
                id: 'year',
                label: 'Anno di imputazione',
                className: 'text-center',
                value: (line) =>
                    Number(
                        line.year ??
                            defaultPeriod?.year ??
                            economicContext!.year,
                    ),
            },
            ...(!readOnly
                ? [
                      {
                          id: 'actions',
                          label: 'Azioni',
                          canHide: false,
                          header: <span className="sr-only">Azioni</span>,
                      },
                  ]
                : []),
        ],
    });
    const sorted = view.table.getState().sorting.length > 0;
    const hiddenErrors = Object.keys(errors).some((key) => {
        const field = key.startsWith('lines.')
            ? key.split('.').at(-1)
            : undefined;
        const column = view.table
            .getAllLeafColumns()
            .find((column) => column.id === field);
        return column && !column.getIsVisible();
    });
    function change(key: string, patch: Partial<ExpenseLine>) {
        onChange?.(
            lines.map((line) => {
                if (line.key !== key) return line;
                return {
                    ...line,
                    ...patch,
                    yearEdited: line.yearEdited || 'year' in patch,
                };
            }),
        );
    }
    function add() {
        if (lines.length >= 500) return;
        const line = emptyDraftLine(
            filter === 'actual' ? 'actual' : 'allocated',
            defaultDescription,
        );
        line.year = String(economicContext!.year);
        line.period_starts_on = null;
        line.period_ends_on = null;
        pendingFocus.current = line.key;
        setSearch('');
        onChange?.([...lines, line]);
    }
    function duplicate(keys: string[]) {
        const copies: string[] = [];
        onChange?.(
            lines.flatMap((line) => {
                if (!keys.includes(line.key)) return [line];
                const key = lineKey();
                copies.push(key);
                return [line, { ...line, key }];
            }),
        );
        setSelected(copies);
    }
    function remove(keys: string[]) {
        onChange?.(lines.filter((line) => !keys.includes(line.key)));
        setSelected((previous) =>
            previous.filter((key) => !keys.includes(key)),
        );
    }
    function move(index: number, offset: number) {
        const next = [...lines];
        [next[index], next[index + offset]] = [
            next[index + offset],
            next[index],
        ];
        onChange?.(next);
    }
    function focusInvalidField() {
        requestAnimationFrame(() =>
            fields.current
                ?.querySelector<HTMLElement>('[aria-invalid="true"]')
                ?.focus(),
        );
    }
    function resetFilters() {
        setSearch('');
        setFilter('all');
    }
    function editable(
        line: DraftLine,
        field: keyof ExpenseLine,
        label: string,
        display?: React.ReactNode,
    ) {
        if (!onSaveLine) return display ?? String(line[field] ?? '—');
        return (
            <InlineEdit
                value={String(line[field] ?? '')}
                label={label}
                disabled={disabled}
                type={field.endsWith('_on') ? 'date' : 'text'}
                display={display}
                options={
                    field === 'type'
                        ? [
                              { value: 'allocated', label: allocatedLabel },
                              { value: 'actual', label: 'Effettivo' },
                          ]
                        : undefined
                }
                onSave={(value) => onSaveLine(line.key, field, value)}
            />
        );
    }
    const format = (cents: bigint) => money(Number(cents) / 100);
    return (
        <section
            ref={fields}
            className="flex min-w-0 flex-col gap-3"
            aria-label={readOnly ? 'Dettaglio spesa' : 'Righe della spesa'}
        >
            {showHeading && (
                <div className="flex flex-wrap items-center gap-2">
                    {showHeading && (
                        <h2 className="mr-auto font-semibold">
                            Righe della spesa
                        </h2>
                    )}
                    {showHeading && readOnly && (
                        <Badge variant="secondary">
                            {visible.length} di {lines.length}
                        </Badge>
                    )}
                </div>
            )}
            {(showFilters || sorted || !readOnly) && (
                <div className="flex flex-wrap items-center gap-2">
                    {showFilters && (
                        <TableFilters
                            title="Filtri righe economiche"
                            count={
                                (search ? 1 : 0) + (filter !== 'all' ? 1 : 0)
                            }
                            disabled={disabled}
                        >
                            <div className="flex flex-col gap-3">
                                <Input
                                    aria-label="Cerca nelle descrizioni delle righe"
                                    placeholder="Cerca nelle righe…"
                                    value={search}
                                    onChange={(event) =>
                                        setSearch(event.target.value)
                                    }
                                    disabled={disabled}
                                    className="min-w-40 flex-1"
                                />
                                <NativeSelect
                                    aria-label="Filtra righe per tipo"
                                    value={filter}
                                    disabled={disabled}
                                    onChange={(event) =>
                                        setFilter(event.target.value)
                                    }
                                >
                                    <NativeSelectOption value="all">
                                        Tutti i tipi
                                    </NativeSelectOption>
                                    <NativeSelectOption value="allocated">
                                        Allocati
                                    </NativeSelectOption>
                                    <NativeSelectOption value="actual">
                                        Effettivi
                                    </NativeSelectOption>
                                </NativeSelect>
                                {filtered && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        disabled={disabled}
                                        onClick={resetFilters}
                                    >
                                        Azzera filtri
                                    </Button>
                                )}
                            </div>
                        </TableFilters>
                    )}
                    {sorted && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={disabled}
                            onClick={() => view.table.setSorting([])}
                        >
                            Ripristina ordine manuale
                        </Button>
                    )}
                    {!readOnly && (
                        <Button
                            type="button"
                            variant="outline"
                            className="ml-auto"
                            disabled={disabled || lines.length >= 500}
                            onClick={add}
                        >
                            <Plus data-icon="inline-start" /> Aggiungi riga
                        </Button>
                    )}
                </div>
            )}
            {readOnly && filtered && (
                <p className="text-xs text-muted-foreground">
                    {visible.length} di {lines.length} righe visibili
                </p>
            )}
            {hiddenErrors && (
                <p role="alert" className="text-sm text-destructive">
                    Ci sono campi da correggere nelle colonne nascoste.{' '}
                    <Button
                        type="button"
                        variant="link"
                        onClick={() => {
                            view.reset();
                            focusInvalidField();
                        }}
                    >
                        Mostra tutte le colonne
                    </Button>
                </p>
            )}
            {errors.lines && (
                <p role="alert" className="text-sm text-destructive">
                    {errors.lines[0]}
                </p>
            )}
            {filtered &&
                Object.keys(errors).some((key) => key.startsWith('lines.')) && (
                    <p role="alert" className="text-sm text-destructive">
                        Ci sono righe da correggere.{' '}
                        <Button
                            type="button"
                            variant="link"
                            onClick={() => {
                                resetFilters();
                                focusInvalidField();
                            }}
                        >
                            Mostra tutte le righe
                        </Button>
                    </p>
                )}
            {!readOnly && selectedLines.length > 0 && (
                <div
                    className="flex flex-wrap items-center gap-2 rounded-md bg-muted p-2 text-sm"
                    aria-label="Operazioni sulle righe selezionate"
                >
                    <span className="mr-auto" role="status">
                        {selectedLines.length} righe selezionate
                        {selectedLines.length > visibleSelected
                            ? ` (${selectedLines.length - visibleSelected} nascoste dai filtri)`
                            : ''}
                    </span>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={disabled}
                        onClick={() =>
                            onChange?.(
                                lines.map((line) =>
                                    selected.includes(line.key)
                                        ? { ...line, type: 'allocated' }
                                        : line,
                                ),
                            )
                        }
                    >
                        Imposta allocati
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={disabled}
                        onClick={() =>
                            onChange?.(
                                lines.map((line) =>
                                    selected.includes(line.key)
                                        ? { ...line, type: 'actual' }
                                        : line,
                                ),
                            )
                        }
                    >
                        Imposta effettivi
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={
                            disabled ||
                            lines.length + selectedLines.length > 500
                        }
                        onClick={() => duplicate(selected)}
                    >
                        <Copy className="size-4" /> Duplica
                    </Button>
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={disabled}
                        onClick={() => remove(selected)}
                    >
                        <Trash2 className="size-4" /> Elimina
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={disabled}
                        onClick={() => setSelected([])}
                    >
                        Deseleziona
                    </Button>
                </div>
            )}
            <div
                className={cn(
                    'min-w-0 overflow-hidden rounded-lg bg-card',
                    !readOnly && 'border',
                )}
            >
                <Table>
                    <TableViewHeader view={view} disabled={disabled} />
                    <TableBody>
                        {!visible.length && (
                            <TableRow>
                                <TableCell
                                    colSpan={
                                        view.table.getVisibleLeafColumns()
                                            .length
                                    }
                                    className="py-6 text-center text-muted-foreground"
                                >
                                    {lines.length
                                        ? 'Nessuna riga corrisponde ai filtri.'
                                        : readOnly
                                          ? 'Non sono presenti righe dettagliate.'
                                          : 'Nessuna riga. Aggiungi una riga per inserire un importo.'}
                                </TableCell>
                            </TableRow>
                        )}
                        {view.table
                            .getRowModel()
                            .rows.map(({ original: line }) => {
                                const index = lines.indexOf(line);
                                const cents = lineCents(line);
                                const fieldError = (field: string) =>
                                    errors[`lines.${index}.${field}`]?.[0];
                                const label = `riga ${index + 1}`;
                                return (
                                    <TableRow
                                        key={line.key}
                                        className={cn(
                                            readOnly
                                                ? 'transition-colors hover:bg-muted/40 [&>td]:align-middle'
                                                : '[&>td]:align-top',
                                        )}
                                        data-state={
                                            selected.includes(line.key)
                                                ? 'selected'
                                                : undefined
                                        }
                                    >
                                        <TableViewCells table={view.table}>
                                            {!readOnly && (
                                                <TableCell key="select">
                                                    <Checkbox
                                                        aria-label={`Seleziona ${label}`}
                                                        className="mt-2"
                                                        checked={selected.includes(
                                                            line.key,
                                                        )}
                                                        disabled={disabled}
                                                        onCheckedChange={(
                                                            checked,
                                                        ) =>
                                                            setSelected(
                                                                (previous) =>
                                                                    checked ===
                                                                    true
                                                                        ? [
                                                                              ...previous,
                                                                              line.key,
                                                                          ]
                                                                        : previous.filter(
                                                                              (
                                                                                  key,
                                                                              ) =>
                                                                                  key !==
                                                                                  line.key,
                                                                          ),
                                                            )
                                                        }
                                                    />
                                                </TableCell>
                                            )}
                                            {!readOnly && (
                                                <TableCell key="order">
                                                    <div className="flex items-center gap-1">
                                                        <span className="w-5 text-xs tabular-nums">
                                                            {index + 1}
                                                        </span>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            aria-label={`Sposta su ${label}`}
                                                            disabled={
                                                                disabled ||
                                                                filtered ||
                                                                sorted ||
                                                                index === 0
                                                            }
                                                            onClick={() =>
                                                                move(index, -1)
                                                            }
                                                        >
                                                            <ArrowUp />
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            aria-label={`Sposta giù ${label}`}
                                                            disabled={
                                                                disabled ||
                                                                filtered ||
                                                                sorted ||
                                                                index ===
                                                                    lines.length -
                                                                        1
                                                            }
                                                            onClick={() =>
                                                                move(index, 1)
                                                            }
                                                        >
                                                            <ArrowDown />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            )}
                                            <TableCell
                                                key="type"
                                                className={cn(
                                                    readOnly
                                                        ? 'min-w-32'
                                                        : 'relative min-w-40 pr-10',
                                                )}
                                            >
                                                {readOnly ? (
                                                    editable(
                                                        line,
                                                        'type',
                                                        `Tipo ${label}`,
                                                        <Badge
                                                            variant={
                                                                line.type ===
                                                                'allocated'
                                                                    ? 'outline'
                                                                    : 'secondary'
                                                            }
                                                        >
                                                            {line.type ===
                                                            'allocated'
                                                                ? allocatedLabel
                                                                : 'Effettivo'}
                                                        </Badge>,
                                                    )
                                                ) : (
                                                    <NativeSelect
                                                        aria-label={`Tipo ${label}`}
                                                        aria-describedby={
                                                            fieldError('type')
                                                                ? `${errorId}-${line.key}-type`
                                                                : undefined
                                                        }
                                                        aria-invalid={
                                                            !!fieldError('type')
                                                        }
                                                        value={line.type}
                                                        disabled={disabled}
                                                        onChange={(event) =>
                                                            change(line.key, {
                                                                type: event
                                                                    .target
                                                                    .value as ExpenseLine['type'],
                                                            })
                                                        }
                                                    >
                                                        <NativeSelectOption value="allocated">
                                                            {allocatedLabel}
                                                        </NativeSelectOption>
                                                        <NativeSelectOption value="actual">
                                                            Effettivo
                                                        </NativeSelectOption>
                                                    </NativeSelect>
                                                )}
                                                <CellError
                                                    id={`${errorId}-${line.key}-type`}
                                                    label={`Tipo ${label}`}
                                                    message={fieldError('type')}
                                                />
                                            </TableCell>
                                            <TableCell
                                                key="description"
                                                className={cn(
                                                    !readOnly &&
                                                        'relative pr-10',
                                                    'w-full whitespace-normal',
                                                    readOnly
                                                        ? 'min-w-32 font-medium [overflow-wrap:anywhere] sm:min-w-48'
                                                        : 'min-w-80',
                                                )}
                                            >
                                                {readOnly ? (
                                                    <div className="flex flex-col gap-1.5">
                                                        {editable(
                                                            line,
                                                            'description',
                                                            `Descrizione ${label}`,
                                                            line.description,
                                                        )}
                                                    </div>
                                                ) : (
                                                    <Input
                                                        ref={(input) => {
                                                            if (
                                                                input &&
                                                                pendingFocus.current ===
                                                                    line.key
                                                            ) {
                                                                pendingFocus.current =
                                                                    null;
                                                                input.focus();
                                                                input.scrollIntoView(
                                                                    {
                                                                        block: 'nearest',
                                                                        inline: 'nearest',
                                                                    },
                                                                );
                                                            }
                                                        }}
                                                        aria-label={`Descrizione ${label}`}
                                                        aria-describedby={
                                                            fieldError(
                                                                'description',
                                                            )
                                                                ? `${errorId}-${line.key}-description`
                                                                : undefined
                                                        }
                                                        aria-invalid={
                                                            !!fieldError(
                                                                'description',
                                                            )
                                                        }
                                                        value={line.description}
                                                        disabled={disabled}
                                                        maxLength={255}
                                                        onChange={(event) =>
                                                            change(line.key, {
                                                                description:
                                                                    event.target
                                                                        .value,
                                                            })
                                                        }
                                                    />
                                                )}
                                                <CellError
                                                    id={`${errorId}-${line.key}-description`}
                                                    label={`Descrizione ${label}`}
                                                    message={fieldError(
                                                        'description',
                                                    )}
                                                />
                                            </TableCell>
                                            <TableCell
                                                key="unit_price"
                                                className={cn(
                                                    readOnly
                                                        ? 'w-32 min-w-32'
                                                        : 'relative w-40 min-w-40 pr-10',
                                                    'text-right financial-value',
                                                )}
                                            >
                                                {readOnly ? (
                                                    editable(
                                                        line,
                                                        'unit_price',
                                                        `Prezzo unitario ${label}`,
                                                        money(line.unit_price),
                                                    )
                                                ) : (
                                                    <MoneyField
                                                        aria-label={`Prezzo unitario ${label}`}
                                                        aria-describedby={
                                                            fieldError(
                                                                'unit_price',
                                                            )
                                                                ? `${errorId}-${line.key}-unit_price`
                                                                : undefined
                                                        }
                                                        aria-invalid={
                                                            !!fieldError(
                                                                'unit_price',
                                                            )
                                                        }
                                                        inputMode="decimal"
                                                        className="text-right font-medium tracking-normal tabular-nums"
                                                        value={line.unit_price}
                                                        disabled={disabled}
                                                        placeholder="0,00"
                                                        onChange={(value) =>
                                                            change(line.key, {
                                                                unit_price:
                                                                    value,
                                                            })
                                                        }
                                                    />
                                                )}
                                                <CellError
                                                    id={`${errorId}-${line.key}-unit_price`}
                                                    label={`Prezzo unitario ${label}`}
                                                    message={fieldError(
                                                        'unit_price',
                                                    )}
                                                />
                                            </TableCell>
                                            <TableCell
                                                key="quantity"
                                                className={cn(
                                                    readOnly
                                                        ? 'w-24 min-w-24'
                                                        : 'relative w-32 min-w-32 pr-10',
                                                    'text-right financial-value',
                                                )}
                                            >
                                                {readOnly ? (
                                                    editable(
                                                        line,
                                                        'quantity',
                                                        `Quantità ${label}`,
                                                        Number(
                                                            line.quantity,
                                                        ).toLocaleString(
                                                            'it-IT',
                                                            {
                                                                maximumFractionDigits: 4,
                                                            },
                                                        ),
                                                    )
                                                ) : (
                                                    <Input
                                                        aria-label={`Quantità ${label}`}
                                                        aria-describedby={
                                                            fieldError(
                                                                'quantity',
                                                            )
                                                                ? `${errorId}-${line.key}-quantity`
                                                                : undefined
                                                        }
                                                        aria-invalid={
                                                            !!fieldError(
                                                                'quantity',
                                                            )
                                                        }
                                                        inputMode="decimal"
                                                        className="text-right font-medium tracking-normal tabular-nums"
                                                        value={line.quantity}
                                                        disabled={disabled}
                                                        onChange={(event) =>
                                                            change(line.key, {
                                                                quantity:
                                                                    event.target
                                                                        .value,
                                                            })
                                                        }
                                                    />
                                                )}
                                                <CellError
                                                    id={`${errorId}-${line.key}-quantity`}
                                                    label={`Quantità ${label}`}
                                                    message={fieldError(
                                                        'quantity',
                                                    )}
                                                />
                                            </TableCell>
                                            <TableCell
                                                key="total"
                                                className={cn(
                                                    'text-right financial-value',
                                                    readOnly
                                                        ? 'min-w-28'
                                                        : 'min-w-36',
                                                )}
                                            >
                                                {readOnly ? (
                                                    money(line.total)
                                                ) : (
                                                    <MoneyOutput
                                                        label={`Totale ${label}`}
                                                        value={
                                                            cents !== null
                                                                ? Number(
                                                                      cents,
                                                                  ) / 100
                                                                : decimalInput(
                                                                        line.unit_price,
                                                                    ) === null
                                                                  ? 0
                                                                  : null
                                                        }
                                                    />
                                                )}
                                            </TableCell>
                                            <TableCell
                                                key="year"
                                                className="w-px text-center"
                                            >
                                                {readOnly ? (
                                                    onSaveLine ? (
                                                        editable(
                                                            line,
                                                            'year',
                                                            `Anno ${label}`,
                                                            line.year ??
                                                                defaultPeriod?.year ??
                                                                economicContext!
                                                                    .year,
                                                        )
                                                    ) : (
                                                        (line.year ??
                                                        defaultPeriod?.year ??
                                                        economicContext!.year)
                                                    )
                                                ) : (
                                                    <ExpensePeriodFields
                                                        compact
                                                        values={{
                                                            period_starts_on:
                                                                line.period_starts_on ??
                                                                '',
                                                            period_ends_on:
                                                                line.period_ends_on ??
                                                                '',
                                                            year: String(
                                                                line.year ??
                                                                    defaultPeriod?.year ??
                                                                    economicContext!
                                                                        .year,
                                                            ),
                                                        }}
                                                        onChange={(_, value) =>
                                                            change(line.key, {
                                                                year: value,
                                                            })
                                                        }
                                                        disabled={disabled}
                                                        errors={
                                                            fieldError('year')
                                                                ? {
                                                                      year: [
                                                                          fieldError(
                                                                              'year',
                                                                          )!,
                                                                      ],
                                                                  }
                                                                : {}
                                                        }
                                                        showPeriod={false}
                                                        idPrefix={line.key}
                                                        yearLabel={`Anno ${label}`}
                                                    />
                                                )}
                                            </TableCell>
                                            {!readOnly && (
                                                <TableCell key="actions">
                                                    <div className="flex gap-1">
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            aria-label={`Duplica ${label}`}
                                                            disabled={
                                                                disabled ||
                                                                lines.length >=
                                                                    500
                                                            }
                                                            onClick={() =>
                                                                duplicate([
                                                                    line.key,
                                                                ])
                                                            }
                                                        >
                                                            <Copy />
                                                        </Button>
                                                        <Button
                                                            type="button"
                                                            variant="ghost"
                                                            size="icon"
                                                            aria-label={`Elimina ${label}`}
                                                            disabled={disabled}
                                                            onClick={() =>
                                                                remove([
                                                                    line.key,
                                                                ])
                                                            }
                                                        >
                                                            <Trash2 />
                                                        </Button>
                                                    </div>
                                                </TableCell>
                                            )}
                                        </TableViewCells>
                                    </TableRow>
                                );
                            })}
                    </TableBody>
                </Table>
            </div>
            {filtered && !readOnly && (
                <p className="text-sm text-muted-foreground">
                    Azzera i filtri per riordinare le righe.
                </p>
            )}
            {showSummary && (
                <>
                    <h3 className="font-semibold">Riepilogo</h3>
                    <dl
                        className="grid gap-3 rounded-md bg-muted/50 p-3 sm:grid-cols-3"
                        aria-live="polite"
                    >
                        {(
                            [
                                ['Totale (Allocato)', totals.allocated],
                                ['Totale (Effettivo)', totals.actual],
                                ['Scostamento', variance],
                            ] as const
                        ).map(([label, value]) => (
                            <div key={label}>
                                <dt className="text-sm text-muted-foreground">
                                    {label}
                                </dt>
                                <dd
                                    className={cn(
                                        'mt-1 font-semibold tracking-normal break-words text-foreground tabular-nums',
                                        label.startsWith('Scostamento') &&
                                            varianceTextClass(value),
                                    )}
                                >
                                    {value === null
                                        ? 'Da completare'
                                        : format(value)}
                                </dd>
                            </div>
                        ))}
                    </dl>
                </>
            )}
        </section>
    );
}
