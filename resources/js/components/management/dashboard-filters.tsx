import { router } from '@inertiajs/react';
import { Plus, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { TableSearchInput } from './table-search-input';
import { useTableSearch } from '@/hooks/use-table-search';
import { TableFilters } from './table-view';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';

import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { RecordSelect } from './record-select';
import type { ExpensePageProps, Filters } from './types';

export function applyFilters(path: string, filters: Filters) {
    const query = Object.fromEntries(
        Object.entries(filters).filter(
            ([, value]) => value !== '' && value !== undefined,
        ),
    );
    router.get(path, query, { preserveState: true, preserveScroll: true });
}

export function DashboardFilters({
    tenant,
    expenses,
    filters,
    options,
    path,
    busy = false,
    onCreate,
    createAction,
    hideRelations = [],
    contractMode = false,
}: Omit<ExpensePageProps, 'totals'> & {
    path: string;
    busy?: boolean;
    onCreate?: () => void;
    createAction?: ReactNode;
    hideRelations?: ('vendors' | 'contracts' | 'projects')[];
    contractMode?: boolean;
}) {
    const [draft, setDraft] = useState(filters);
    const [previousFilters, setPreviousFilters] = useState(filters);
    if (previousFilters !== filters) {
        setPreviousFilters(filters);
        setDraft(filters);
    }
    const [search, changeSearch] = useTableSearch(path, filters);
    const year = filters.year;
    const secondaryFilters = [
        {
            catalog: 'vendors',
            field: 'vendor_id',
            label: 'Fornitore',
            all: 'Tutti i fornitori',
            relation: 'vendor',
        },
        {
            catalog: 'contracts',
            field: 'contract_id',
            label: 'Contratto',
            all: 'Tutti i contratti',
            relation: 'contract',
        },
        {
            catalog: 'projects',
            field: 'project_id',
            label: 'Progetto',
            all: 'Tutti i progetti',
            relation: 'project',
        },
    ] as const;
    const relationFilters = secondaryFilters.filter(
        ({ catalog }) => !hideRelations.includes(catalog),
    );
    const activeFilters = relationFilters.filter(
        ({ field }) => filters[field],
    ).length;

    return (
        <>
            <TableFilters
                title="Filtri spese"
                count={activeFilters + (filters.search ? 1 : 0)}
                disabled={busy}
            >
                <form
                    className="flex flex-col gap-4"
                    onSubmit={(event) => {
                        event.preventDefault();
                        applyFilters(path, { ...draft, search });
                    }}
                >
                    <FieldGroup>
                        {relationFilters.map(
                            ({ catalog, field, label, all, relation }) => (
                                <Field key={field}>
                                    <FieldLabel htmlFor={`filter-${field}`}>
                                        {label}
                                    </FieldLabel>
                                    <RecordSelect
                                        id={`filter-${field}`}
                                        slug={tenant.slug}
                                        catalog={catalog}
                                        value={draft[field] ?? ''}
                                        onChange={(value) =>
                                            setDraft({
                                                ...draft,
                                                [field]: value,
                                            })
                                        }
                                        options={[
                                            ...options[catalog],
                                            ...expenses.data.flatMap(
                                                (expense) =>
                                                    expense[relation]
                                                        ? [expense[relation]!]
                                                        : [],
                                            ),
                                        ]}
                                        label={all}
                                        includeNone
                                        disabled={busy}
                                    />
                                </Field>
                            ),
                        )}
                        <Field>
                            <FieldLabel>Ordina per</FieldLabel>
                            <Select
                                value={`${draft.sort ?? 'title'}:${draft.direction ?? 'asc'}`}
                                disabled={busy}
                                onValueChange={(value) => {
                                    const [sort, direction] = value.split(':');
                                    setDraft({ ...draft, sort, direction });
                                }}
                            >
                                <SelectTrigger aria-label="Ordinamento spese">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {[
                                            ['title', 'Descrizione'],
                                            ['allocated_amount', 'Allocato'],
                                            ['actual_amount', 'Effettivo'],
                                            ['updated_at', 'Ultima modifica'],
                                            ...(hideRelations.length
                                                ? [
                                                      [
                                                          'year',
                                                          'Anno di imputazione',
                                                      ],
                                                      ...(contractMode
                                                          ? [
                                                                [
                                                                    'period_starts_on',
                                                                    'Periodo coperto',
                                                                ],
                                                            ]
                                                          : []),
                                                  ]
                                                : []),
                                        ].flatMap(([field, label]) =>
                                            ['asc', 'desc'].map((direction) => (
                                                <SelectItem
                                                    key={`${field}:${direction}`}
                                                    value={`${field}:${direction}`}
                                                >
                                                    {label} ·{' '}
                                                    {direction === 'asc'
                                                        ? 'crescente'
                                                        : 'decrescente'}
                                                </SelectItem>
                                            )),
                                        )}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </Field>
                    </FieldGroup>
                    <Button
                        type="button"
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                            setDraft({
                                year,
                                history: filters.history,
                                sort: filters.sort,
                                direction: filters.direction,
                            })
                        }
                    >
                        Azzera selezione
                    </Button>
                    <Button
                        type="button"
                        className="w-full"
                        disabled={busy}
                        onClick={() => {
                            applyFilters(path, { ...draft, search });
                        }}
                    >
                        Applica filtri
                    </Button>
                </form>
            </TableFilters>
            <TableSearchInput
                value={search}
                onChange={changeSearch}
                disabled={busy}
            />
            {(activeFilters > 0 || filters.search) && (
                <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                        const reset = {
                            year,
                            history: filters.history,
                            sort: filters.sort,
                            direction: filters.direction,
                        };
                        setDraft(reset);
                        applyFilters(path, reset);
                    }}
                >
                    Azzera filtri
                </Button>
            )}
            {createAction ??
                (onCreate && (
                    <Button
                        type="button"
                        className="w-full sm:ml-auto sm:w-auto"
                        disabled={busy}
                        onClick={onCreate}
                    >
                        <Plus data-icon="inline-start" />
                        Nuova spesa
                    </Button>
                ))}
            {activeFilters > 0 && (
                <div
                    className="flex w-full flex-wrap gap-2 border-t pt-3"
                    aria-label="Filtri applicati"
                >
                    {relationFilters
                        .filter(({ field }) => filters[field])
                        .map(({ field, catalog, label, relation }) => {
                            const selected = [
                                ...options[catalog],
                                ...expenses.data.flatMap((expense) =>
                                    expense[relation]
                                        ? [expense[relation]!]
                                        : [],
                                ),
                            ].find(
                                (option) =>
                                    String(option.id) === filters[field],
                            );
                            const name =
                                filters[field] === 'none'
                                    ? 'Senza collegamento'
                                    : (selected?.name ??
                                      `Elemento #${filters[field]}`);
                            return (
                                <Button
                                    key={field}
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    disabled={busy}
                                    className="h-auto min-h-8 max-w-full whitespace-normal"
                                    aria-label={`Rimuovi filtro ${label}: ${name}`}
                                    onClick={() =>
                                        applyFilters(path, {
                                            ...filters,
                                            [field]: '',
                                        })
                                    }
                                >
                                    {label}: {name}
                                    <X data-icon="inline-end" />
                                </Button>
                            );
                        })}
                </div>
            )}
        </>
    );
}
