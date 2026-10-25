import { DetailHero } from '@/components/management/detail-hero';
import { ProjectStatusSelect } from '@/components/management/project-status-select';
import {
    InlineEdit,
    saveInlineRecord,
} from '@/components/management/inline-edit';
import { SpreadsheetActions } from '@/components/management/spreadsheet-actions';
import { Head, Link, router } from '@inertiajs/react';
import {
    Plus,
    Ellipsis,
    ArrowUpRight,
    FileText,
    FolderKanban,
    Handshake,
} from 'lucide-react';
import { useState } from 'react';
import {
    useTableView,
    TableFilters,
    TableViewHeader,
    TableViewCells,
} from '@/components/management/table-view';
import { DeleteRecord } from '@/components/management/delete-record';
import { CostCenterTags } from '@/components/management/cost-center-tags';
import { CostCenterSelect } from '@/components/management/cost-center-select';
import { applyFilters } from '@/components/management/expense-workspace';
import { dateLabel } from '@/components/management/helpers';
import { Pagination } from '@/components/management/pagination';
import { RecordSelect } from '@/components/management/record-select';
import {
    labels,
    singular,
    projectStatusLabel,
} from '@/components/management/types';
import type {
    Catalog,
    Filters,
    Options,
    Pagination as Page,
    RecordData,
} from '@/components/management/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { TableSearchInput } from '@/components/management/table-search-input';
import { useTableSearch } from '@/hooks/use-table-search';
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
    Empty,
    EmptyHeader,
    EmptyTitle,
    EmptyDescription,
} from '@/components/ui/empty';
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import type { Tenant } from '@/types';

const catalogHeroes = {
    contracts: { icon: FileText, accent: 'contract' },
    projects: { icon: FolderKanban, accent: 'project' },
    vendors: { icon: Handshake, accent: 'vendor' },
} as const;

export default function CatalogPage({
    tenant,
    catalog,
    records,
    filters,
    options,
}: {
    tenant: Tenant;
    catalog: Catalog;
    records: Page<RecordData>;
    filters: Filters;
    options: Options;
}) {
    'use no memo'; // TanStack v8 exposes mutable table and column instances.

    const [deleting, setDeleting] = useState<RecordData | null>(null);
    const path = `/t/${tenant.slug}/${catalog}`;
    const [search, changeSearch] = useTableSearch(path, filters);
    const view = useTableView<RecordData>({
        rows: records.data,
        storageKey: `mp3:table:v1:${tenant.slug}:${catalog}`,
        sorting: [
            { id: filters.sort ?? 'name', desc: filters.direction === 'desc' },
        ],
        onSortingChange: (sorting) => {
            if (sorting[0])
                applyFilters(path, {
                    ...filters,
                    sort: sorting[0].id,
                    direction: sorting[0].desc ? 'desc' : 'asc',
                });
        },
        columns: [
            {
                id: 'name',
                label: 'Nome',
                value: (record) => record.name,
                canHide: false,
            },
            ...(catalog === 'vendors'
                ? [
                      { id: 'vat_number', label: 'Partita IVA' },
                      { id: 'email', label: 'Email' },
                      { id: 'phone', label: 'Telefono' },
                  ]
                : [
                      ...(catalog === 'contracts'
                          ? [{ id: 'vendor_id', label: 'Fornitore' }]
                          : [{ id: 'status', label: 'Stato' }]),
                      { id: 'cost_center_ids', label: 'Centri di costo' },
                      { id: 'starts_on', label: 'Data iniziale' },
                      { id: 'ends_on', label: 'Data finale' },
                  ]),
            {
                id: 'expenses_count',
                label: 'Spese collegate · storico',
                value: (record) => record.expenses_count,
                className: 'text-right',
            },
            {
                id: 'actions',
                label: 'Azioni',
                canHide: false,
                className: 'w-12',
                header: <span className="sr-only">Azioni</span>,
            },
        ],
    });
    const activeFilterCount = [
        filters.search,
        filters.vendor_id,
        filters.status,
        filters.expiring === '1',
        filters.linked === '1',
    ].filter(Boolean).length;
    return (
        <>
            <Head title={`${labels[catalog]} · ${tenant.name}`} />
            <div className="page-shell detail-enter">
                <DetailHero
                    icon={catalogHeroes[catalog].icon}
                    accent={catalogHeroes[catalog].accent}
                    actions={
                        <SpreadsheetActions
                            slug={tenant.slug}
                            resource={catalog}
                            label={labels[catalog]}
                            filters={filters}
                        />
                    }
                >
                    <h1 className="page-title">{labels[catalog]}</h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        {tenant.name}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                        {
                            {
                                vendors:
                                    'Anagrafiche e spese collegate ai tuoi fornitori.',
                                projects:
                                    'Stato, periodo e costi dei progetti.',
                                contracts:
                                    'Riferimenti, scadenze e spese dei contratti.',
                            }[catalog]
                        }
                    </p>
                </DetailHero>
                {catalog !== 'vendors' &&
                    records.data.some((record) => record.year == null) && (
                        <p
                            role="note"
                            className="text-sm text-muted-foreground"
                        >
                            Sono presenti{' '}
                            {catalog === 'contracts' ? 'contratti' : 'progetti'}{' '}
                            storici senza anno. Restano consultabili; la
                            modifica e l’importazione annuale richiedono una
                            classificazione esplicita.
                        </p>
                    )}
                <Card>
                    <CardContent className="flex min-w-0 flex-col gap-5">
                        <div className="flex flex-wrap items-center gap-2">
                            <TableFilters
                                title={`Filtri ${labels[catalog].toLocaleLowerCase('it')}`}
                                count={activeFilterCount}
                                disabled={deleting !== null}
                            >
                                <div className="flex flex-col gap-3">
                                    <Select
                                        value={filters.direction ?? 'asc'}
                                        onValueChange={(direction) =>
                                            applyFilters(path, {
                                                ...filters,
                                                direction,
                                            })
                                        }
                                    >
                                        <SelectTrigger
                                            className="w-full"
                                            aria-label="Ordina per nome"
                                        >
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectGroup>
                                                <SelectItem value="asc">
                                                    Nome A–Z
                                                </SelectItem>
                                                <SelectItem value="desc">
                                                    Nome Z–A
                                                </SelectItem>
                                            </SelectGroup>
                                        </SelectContent>
                                    </Select>
                                    {catalog === 'projects' && (
                                        <Select
                                            value={filters.status || 'all'}
                                            onValueChange={(status) =>
                                                applyFilters(path, {
                                                    ...filters,
                                                    status:
                                                        status === 'all'
                                                            ? ''
                                                            : status,
                                                })
                                            }
                                        >
                                            <SelectTrigger
                                                className="w-full"
                                                aria-label="Filtra stato"
                                            >
                                                <SelectValue />
                                            </SelectTrigger>
                                            <SelectContent>
                                                <SelectGroup>
                                                    <SelectItem value="all">
                                                        Tutti gli stati
                                                    </SelectItem>
                                                    <SelectItem value="none">
                                                        Nessuno stato
                                                    </SelectItem>
                                                    {options.project_statuses.map(
                                                        (status) => (
                                                            <SelectItem
                                                                value={
                                                                    status.key
                                                                }
                                                                key={status.key}
                                                            >
                                                                {status.name}
                                                            </SelectItem>
                                                        ),
                                                    )}
                                                </SelectGroup>
                                            </SelectContent>
                                        </Select>
                                    )}
                                    {catalog === 'contracts' && (
                                        <>
                                            <div className="w-full">
                                                <RecordSelect
                                                    slug={tenant.slug}
                                                    catalog="vendors"
                                                    value={
                                                        filters.vendor_id ?? ''
                                                    }
                                                    label="Tutti i fornitori"
                                                    options={options.vendors}
                                                    onChange={(vendor_id) =>
                                                        applyFilters(path, {
                                                            ...filters,
                                                            vendor_id,
                                                        })
                                                    }
                                                />
                                            </div>
                                            <Button
                                                type="button"
                                                variant={
                                                    filters.expiring === '1'
                                                        ? 'secondary'
                                                        : 'outline'
                                                }
                                                onClick={() =>
                                                    applyFilters(path, {
                                                        ...filters,
                                                        expiring:
                                                            filters.expiring ===
                                                            '1'
                                                                ? ''
                                                                : '1',
                                                    })
                                                }
                                            >
                                                In scadenza entro 90 giorni
                                            </Button>
                                        </>
                                    )}
                                    {catalog === 'vendors' && (
                                        <Button
                                            type="button"
                                            variant={
                                                filters.linked === '1'
                                                    ? 'secondary'
                                                    : 'outline'
                                            }
                                            onClick={() =>
                                                applyFilters(path, {
                                                    ...filters,
                                                    linked:
                                                        filters.linked === '1'
                                                            ? ''
                                                            : '1',
                                                })
                                            }
                                        >
                                            Con spese collegate
                                        </Button>
                                    )}
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        onClick={() => {
                                            applyFilters(path, {});
                                        }}
                                    >
                                        Azzera
                                    </Button>
                                </div>
                            </TableFilters>
                            <TableSearchInput
                                value={search}
                                onChange={changeSearch}
                                disabled={deleting !== null}
                            />
                            <Button
                                type="button"
                                className="w-full sm:ml-auto sm:w-auto"
                                disabled={deleting !== null}
                                onClick={() => router.visit(`${path}/create`)}
                            >
                                <Plus data-icon="inline-start" />
                                Nuovo {singular[catalog]}
                            </Button>
                        </div>
                        {records.data.length === 0 ? (
                            <Empty className="border">
                                <EmptyHeader>
                                    <EmptyTitle>
                                        {filters.search
                                            ? 'Nessun risultato per la ricerca'
                                            : `Nessun ${singular[catalog]} trovato`}
                                    </EmptyTitle>
                                    <EmptyDescription>
                                        Modifica la ricerca oppure aggiungi il
                                        primo elemento.
                                    </EmptyDescription>
                                </EmptyHeader>
                            </Empty>
                        ) : (
                            <div className="min-w-0 overflow-hidden rounded-lg border bg-card">
                                <Table>
                                    <TableViewHeader
                                        view={view}
                                        disabled={deleting !== null}
                                    />
                                    <TableBody>
                                        {view.table
                                            .getRowModel()
                                            .rows.map(
                                                ({ original: record }) => (
                                                    <TableRow key={record.id}>
                                                        <TableViewCells
                                                            table={view.table}
                                                        >
                                                            <TableCell
                                                                key="name"
                                                                className="max-w-80 min-w-48 font-medium break-words whitespace-normal"
                                                            >
                                                                {catalog ===
                                                                'vendors' ? (
                                                                    <div className="flex items-center gap-2">
                                                                        <InlineEdit
                                                                            value={
                                                                                record.name
                                                                            }
                                                                            label={`Nome di ${record.display_name ?? record.name}`}
                                                                            disabled={
                                                                                deleting !==
                                                                                null
                                                                            }
                                                                            className="flex-1"
                                                                            onSave={(
                                                                                value,
                                                                            ) =>
                                                                                saveInlineRecord(
                                                                                    `${path}/${record.id}`,
                                                                                    {
                                                                                        name: value,
                                                                                    },
                                                                                )
                                                                            }
                                                                        />
                                                                        <Button
                                                                            asChild
                                                                            variant="ghost"
                                                                            size="icon"
                                                                        >
                                                                            <Link
                                                                                href={`${path}/${record.id}`}
                                                                                aria-label={`Apri ${record.display_name ?? record.name}`}
                                                                            >
                                                                                <ArrowUpRight />
                                                                            </Link>
                                                                        </Button>
                                                                    </div>
                                                                ) : (
                                                                    <Link
                                                                        href={`${path}/${record.id}`}
                                                                        aria-label={`Apri ${record.display_name ?? record.name}`}
                                                                        className="rounded focus-visible:ring-2 focus-visible:ring-ring"
                                                                    >
                                                                        {record.display_name ??
                                                                            record.name}
                                                                    </Link>
                                                                )}
                                                            </TableCell>
                                                            {catalog !==
                                                            'vendors' ? (
                                                                <>
                                                                    {catalog ===
                                                                    'contracts' ? (
                                                                        <TableCell
                                                                            key="vendor_id"
                                                                            className="min-w-40 whitespace-normal"
                                                                        >
                                                                            <InlineEdit
                                                                                value={
                                                                                    record.vendor_id ==
                                                                                    null
                                                                                        ? ''
                                                                                        : String(
                                                                                              record.vendor_id,
                                                                                          )
                                                                                }
                                                                                label={`Fornitore di ${record.display_name ?? record.name}`}
                                                                                disabled={
                                                                                    deleting !==
                                                                                    null
                                                                                }
                                                                                display={
                                                                                    record
                                                                                        .vendor
                                                                                        ?.name ??
                                                                                    'Non assegnato'
                                                                                }
                                                                                renderEditor={({
                                                                                    value,
                                                                                    onChange,
                                                                                    disabled,
                                                                                    invalid,
                                                                                }) => (
                                                                                    <RecordSelect
                                                                                        slug={
                                                                                            tenant.slug
                                                                                        }
                                                                                        catalog="vendors"
                                                                                        value={
                                                                                            value
                                                                                        }
                                                                                        onChange={
                                                                                            onChange
                                                                                        }
                                                                                        options={[
                                                                                            ...options.vendors,
                                                                                            ...(record.vendor
                                                                                                ? [
                                                                                                      record.vendor,
                                                                                                  ]
                                                                                                : []),
                                                                                        ]}
                                                                                        label="Fornitore"
                                                                                        disabled={
                                                                                            disabled
                                                                                        }
                                                                                        aria-invalid={
                                                                                            invalid
                                                                                        }
                                                                                    />
                                                                                )}
                                                                                onSave={(
                                                                                    value,
                                                                                ) =>
                                                                                    saveInlineRecord(
                                                                                        `${path}/${record.id}`,
                                                                                        {
                                                                                            vendor_id:
                                                                                                value
                                                                                                    ? Number(
                                                                                                          value,
                                                                                                      )
                                                                                                    : null,
                                                                                        },
                                                                                    )
                                                                                }
                                                                            />
                                                                        </TableCell>
                                                                    ) : (
                                                                        <TableCell key="status">
                                                                            <InlineEdit
                                                                                value={
                                                                                    record.status
                                                                                }
                                                                                label={`Stato di ${record.display_name ?? record.name}`}
                                                                                disabled={
                                                                                    deleting !==
                                                                                    null
                                                                                }
                                                                                display={
                                                                                    <Badge variant="secondary">
                                                                                        {projectStatusLabel(
                                                                                            record.status,
                                                                                            options.project_statuses,
                                                                                        )}
                                                                                    </Badge>
                                                                                }
                                                                                renderEditor={({
                                                                                    value,
                                                                                    onChange,
                                                                                    disabled,
                                                                                    invalid,
                                                                                    onCancel,
                                                                                }) => (
                                                                                    <ProjectStatusSelect
                                                                                        statuses={
                                                                                            options.project_statuses
                                                                                        }
                                                                                        value={
                                                                                            value
                                                                                        }
                                                                                        onChange={
                                                                                            onChange
                                                                                        }
                                                                                        disabled={
                                                                                            disabled
                                                                                        }
                                                                                        invalid={
                                                                                            invalid
                                                                                        }
                                                                                        autoFocus
                                                                                        onCancel={
                                                                                            onCancel
                                                                                        }
                                                                                    />
                                                                                )}
                                                                                onSave={(
                                                                                    value,
                                                                                ) =>
                                                                                    saveInlineRecord(
                                                                                        `${path}/${record.id}`,
                                                                                        {
                                                                                            status:
                                                                                                value ||
                                                                                                null,
                                                                                        },
                                                                                    )
                                                                                }
                                                                            />
                                                                        </TableCell>
                                                                    )}
                                                                    <TableCell
                                                                        key="cost_center_ids"
                                                                        className="min-w-40 whitespace-normal"
                                                                    >
                                                                        <InlineEdit
                                                                            value={JSON.stringify(
                                                                                record.cost_centers?.map(
                                                                                    (
                                                                                        center,
                                                                                    ) =>
                                                                                        center.id,
                                                                                ) ??
                                                                                    [],
                                                                            )}
                                                                            label={`Centri di costo di ${record.display_name ?? record.name}`}
                                                                            disabled={
                                                                                deleting !==
                                                                                null
                                                                            }
                                                                            display={
                                                                                record
                                                                                    .cost_centers
                                                                                    ?.length ? (
                                                                                    <CostCenterTags
                                                                                        centers={
                                                                                            record.cost_centers
                                                                                        }
                                                                                    />
                                                                                ) : (
                                                                                    'Non assegnati'
                                                                                )
                                                                            }
                                                                            renderEditor={({
                                                                                value,
                                                                                onChange,
                                                                                disabled,
                                                                                invalid,
                                                                            }) => (
                                                                                <CostCenterSelect
                                                                                    id={`${catalog}-${record.id}-centers`}
                                                                                    options={[
                                                                                        ...new Map(
                                                                                            [
                                                                                                ...options.cost_centers,
                                                                                                ...(record.cost_centers ??
                                                                                                    []),
                                                                                            ].map(
                                                                                                (
                                                                                                    center,
                                                                                                ) => [
                                                                                                    center.id,
                                                                                                    center,
                                                                                                ],
                                                                                            ),
                                                                                        ).values(),
                                                                                    ]}
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
                                                                            )}
                                                                            onSave={(
                                                                                value,
                                                                            ) =>
                                                                                saveInlineRecord(
                                                                                    `${path}/${record.id}`,
                                                                                    {
                                                                                        cost_center_ids:
                                                                                            JSON.parse(
                                                                                                value,
                                                                                            ) as number[],
                                                                                    },
                                                                                )
                                                                            }
                                                                        />
                                                                    </TableCell>
                                                                    {(
                                                                        [
                                                                            'starts_on',
                                                                            'ends_on',
                                                                        ] as const
                                                                    ).map(
                                                                        (
                                                                            field,
                                                                        ) => (
                                                                            <TableCell
                                                                                key={
                                                                                    field
                                                                                }
                                                                            >
                                                                                <InlineEdit
                                                                                    value={
                                                                                        record[
                                                                                            field
                                                                                        ]
                                                                                    }
                                                                                    type="date"
                                                                                    label={`${field === 'starts_on' ? 'Data iniziale' : 'Data finale'} di ${record.display_name ?? record.name}`}
                                                                                    disabled={
                                                                                        deleting !==
                                                                                        null
                                                                                    }
                                                                                    display={dateLabel(
                                                                                        record[
                                                                                            field
                                                                                        ],
                                                                                    )}
                                                                                    onSave={(
                                                                                        value,
                                                                                    ) =>
                                                                                        saveInlineRecord(
                                                                                            `${path}/${record.id}`,
                                                                                            {
                                                                                                [field]:
                                                                                                    value ||
                                                                                                    null,
                                                                                            },
                                                                                        )
                                                                                    }
                                                                                />
                                                                            </TableCell>
                                                                        ),
                                                                    )}
                                                                </>
                                                            ) : (
                                                                (
                                                                    [
                                                                        'vat_number',
                                                                        'email',
                                                                        'phone',
                                                                    ] as const
                                                                ).map(
                                                                    (field) => (
                                                                        <TableCell
                                                                            key={
                                                                                field
                                                                            }
                                                                            className="min-w-40 whitespace-normal"
                                                                        >
                                                                            <InlineEdit
                                                                                value={
                                                                                    record[
                                                                                        field
                                                                                    ]
                                                                                }
                                                                                label={`${field === 'vat_number' ? 'Partita IVA' : field === 'email' ? 'Email' : 'Telefono'} di ${record.display_name ?? record.name}`}
                                                                                type={
                                                                                    field ===
                                                                                    'email'
                                                                                        ? 'email'
                                                                                        : 'text'
                                                                                }
                                                                                disabled={
                                                                                    deleting !==
                                                                                    null
                                                                                }
                                                                                display={
                                                                                    record[
                                                                                        field
                                                                                    ] ??
                                                                                    (field ===
                                                                                    'phone'
                                                                                        ? 'Non indicato'
                                                                                        : 'Non indicata')
                                                                                }
                                                                                onSave={(
                                                                                    value,
                                                                                ) =>
                                                                                    saveInlineRecord(
                                                                                        `${path}/${record.id}`,
                                                                                        {
                                                                                            [field]:
                                                                                                value ||
                                                                                                null,
                                                                                        },
                                                                                    )
                                                                                }
                                                                            />
                                                                        </TableCell>
                                                                    ),
                                                                )
                                                            )}
                                                            <TableCell
                                                                key="expenses_count"
                                                                className="text-right tabular-nums"
                                                            >
                                                                {
                                                                    record.expenses_count
                                                                }
                                                            </TableCell>
                                                            <TableCell key="actions">
                                                                <DropdownMenu>
                                                                    <DropdownMenuTrigger
                                                                        asChild
                                                                    >
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="icon"
                                                                            aria-label={`Azioni per ${record.display_name ?? record.name}`}
                                                                        >
                                                                            <Ellipsis />
                                                                        </Button>
                                                                    </DropdownMenuTrigger>
                                                                    <DropdownMenuContent align="end">
                                                                        <DropdownMenuGroup>
                                                                            <DropdownMenuItem
                                                                                asChild
                                                                            >
                                                                                <Link
                                                                                    href={`${path}/${record.id}`}
                                                                                >
                                                                                    Apri
                                                                                    dettaglio
                                                                                </Link>
                                                                            </DropdownMenuItem>
                                                                            <DropdownMenuItem
                                                                                asChild
                                                                            >
                                                                                <Link
                                                                                    href={`${path}/${record.id}/edit`}
                                                                                >
                                                                                    Modifica
                                                                                </Link>
                                                                            </DropdownMenuItem>
                                                                            <DropdownMenuSeparator />
                                                                            <DropdownMenuItem
                                                                                variant="destructive"
                                                                                onSelect={() =>
                                                                                    setDeleting(
                                                                                        record,
                                                                                    )
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
                                                ),
                                            )}
                                    </TableBody>
                                </Table>
                            </div>
                        )}
                        <Pagination page={records} />
                    </CardContent>
                </Card>
            </div>
            {deleting && (
                <DeleteRecord
                    url={`${path}/${deleting.id}`}
                    label={deleting.display_name ?? deleting.name ?? ''}
                    open
                    onOpenChange={(open) => {
                        if (!open) setDeleting(null);
                    }}
                />
            )}
        </>
    );
}
CatalogPage.layout = {
    breadcrumbs: [{ title: 'Gestionale', href: '/dashboard' }],
};
