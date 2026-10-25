import { DetailHero } from '@/components/management/detail-hero';
import {
    InlineEdit,
    saveInlineRecord,
} from '@/components/management/inline-edit';
import { SpreadsheetActions } from '@/components/management/spreadsheet-actions';
import { Head, Link, router } from '@inertiajs/react';
import { CornerDownRight, Plus, Ellipsis, Tags } from 'lucide-react';
import { useState } from 'react';
import {
    useTableView,
    TableViewCells,
    TableViewHeader,
} from '@/components/management/table-view';
import { toast } from 'sonner';
import { api } from '@/components/management/helpers';
import { Pagination } from '@/components/management/pagination';
import type {
    CostCenter,
    Option,
    Pagination as Page,
} from '@/components/management/types';
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
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field, FieldLabel, FieldDescription } from '@/components/ui/field';
import { Checkbox } from '@/components/ui/checkbox';
import { TableSearchInput } from '@/components/management/table-search-input';
import { useTableSearch } from '@/hooks/use-table-search';
import { Table, TableBody, TableCell, TableRow } from '@/components/ui/table';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
    Empty,
    EmptyHeader,
    EmptyTitle,
    EmptyDescription,
} from '@/components/ui/empty';
import type { Tenant } from '@/types';

export default function CostCenters({
    tenant,
    records,
    filters,
}: {
    tenant: Tenant;
    records: Page<CostCenter>;
    parents: Option[];
    filters: { search?: string; sort?: string; direction?: string };
}) {
    'use no memo'; // TanStack v8 exposes mutable table and column instances.

    const [deleting, setDeleting] = useState<CostCenter | null>(null);
    const [deleteChildren, setDeleteChildren] = useState(false);
    const [confirmCascade, setConfirmCascade] = useState(false);
    const [busy, setBusy] = useState(false);
    const path = `/t/${tenant.slug}/cost-centers`;
    const [search, changeSearch] = useTableSearch(path, filters);
    const hasChildren = !!deleting?.children?.length;
    async function remove() {
        if (!deleting || busy) return;
        if (deleteChildren && hasChildren && !confirmCascade) {
            setConfirmCascade(true);
            return;
        }
        setBusy(true);
        try {
            await api(`${path}/${deleting.id}`, 'DELETE', {
                delete_children: deleteChildren,
            });
            setDeleting(null);
            toast.success('Centro di Costo eliminato.');
            router.reload();
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : 'Eliminazione non riuscita.',
            );
        } finally {
            setBusy(false);
        }
    }
    const view = useTableView<CostCenter>({
        rows: records.data,
        storageKey: `mp3:table:v1:${tenant.slug}:cost-centers`,
        sorting: [
            { id: filters.sort ?? 'name', desc: filters.direction === 'desc' },
        ],
        onSortingChange: (sorting) => {
            if (sorting[0])
                router.get(
                    path,
                    {
                        ...filters,
                        sort: sorting[0].id,
                        direction: sorting[0].desc ? 'desc' : 'asc',
                    },
                    { preserveState: true, preserveScroll: true },
                );
        },
        columns: [
            {
                id: 'name',
                label: 'Nome',
                value: (center) => center.name,
                canHide: false,
            },
            {
                id: 'expenses_count',
                label: 'Spese collegate',
                className: 'text-right',
            },
            {
                id: 'projects_count',
                label: 'Progetti collegati',
                className: 'text-right',
            },
            {
                id: 'contracts_count',
                label: 'Contratti collegati',
                className: 'text-right',
            },
            {
                id: 'actions',
                label: 'Azioni',
                canHide: false,
                className: 'w-12 text-right',
                header: <span className="sr-only">Azioni</span>,
            },
        ],
    });
    function row(center: CostCenter, child = false) {
        return (
            <TableRow key={center.id}>
                <TableViewCells table={view.table}>
                    <TableCell
                        key="name"
                        className="min-w-48 whitespace-normal"
                    >
                        <div className="flex items-center gap-2">
                            {child && (
                                <CornerDownRight
                                    aria-hidden="true"
                                    className="size-4 shrink-0 text-muted-foreground"
                                />
                            )}
                            <InlineEdit
                                value={center.name}
                                label={`Nome di ${center.name}`}
                                disabled={busy}
                                className="font-medium break-words"
                                onSave={(value) =>
                                    saveInlineRecord(`${path}/${center.id}`, {
                                        name: value,
                                    })
                                }
                            />
                        </div>
                    </TableCell>
                    {(
                        [
                            'expenses_count',
                            'projects_count',
                            'contracts_count',
                        ] as const
                    ).map((field) => (
                        <TableCell
                            key={field}
                            className="text-right tabular-nums"
                        >
                            {center[field] ?? 0}
                        </TableCell>
                    ))}
                    <TableCell key="actions" className="text-right">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    disabled={busy}
                                    aria-label={`Azioni per ${center.name}`}
                                >
                                    <Ellipsis />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                                <DropdownMenuGroup>
                                    {!child && (
                                        <DropdownMenuItem
                                            onSelect={() =>
                                                router.visit(
                                                    `${path}/create?parent_id=${center.id}`,
                                                )
                                            }
                                        >
                                            Aggiungi un figlio
                                        </DropdownMenuItem>
                                    )}
                                    <DropdownMenuItem asChild>
                                        <Link
                                            href={`${path}/${center.id}/edit`}
                                        >
                                            Modifica
                                        </Link>
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        variant="destructive"
                                        onSelect={() => {
                                            setDeleting(center);
                                            setDeleteChildren(false);
                                            setConfirmCascade(false);
                                        }}
                                    >
                                        Elimina
                                    </DropdownMenuItem>
                                </DropdownMenuGroup>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </TableCell>
                </TableViewCells>
            </TableRow>
        );
    }
    return (
        <>
            <Head title={`Centri di Costo · ${tenant.name}`} />
            <div className="page-shell detail-enter">
                <DetailHero
                    icon={Tags}
                    accent="cost-center"
                    actions={
                        <SpreadsheetActions
                            slug={tenant.slug}
                            resource="cost-centers"
                            label="Centri di costo"
                            filters={filters}
                        />
                    }
                >
                    <h1 className="page-title">Centri di Costo</h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        {tenant.name}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                        Tag per categorizzare spese, progetti e contratti. Sono
                        consentiti due livelli: padre e figlio.
                    </p>
                </DetailHero>
                <Card>
                    <CardContent className="flex min-w-0 flex-col gap-4">
                        <div className="flex flex-wrap items-center gap-2">
                            <TableSearchInput
                                value={search}
                                onChange={changeSearch}
                                disabled={busy}
                            />
                            <Button
                                type="button"
                                className="w-full sm:ml-auto sm:w-auto"
                                disabled={busy}
                                onClick={() => router.visit(`${path}/create`)}
                            >
                                <Plus data-icon="inline-start" />
                                Nuovo Centro di Costo
                            </Button>
                        </div>
                        {records.data.length ? (
                            <div className="min-w-0 overflow-hidden rounded-lg border bg-card">
                                <Table>
                                    <TableViewHeader
                                        view={view}
                                        disabled={busy}
                                    />
                                    <TableBody>
                                        {view.table
                                            .getRowModel()
                                            .rows.flatMap(
                                                ({ original: center }) => [
                                                    row(center),
                                                    ...[
                                                        ...(center.children ??
                                                            []),
                                                    ]
                                                        .sort(
                                                            (a, b) =>
                                                                (filters.direction ===
                                                                'desc'
                                                                    ? -1
                                                                    : 1) *
                                                                a.name.localeCompare(
                                                                    b.name,
                                                                    'it',
                                                                ),
                                                        )
                                                        .map((child) =>
                                                            row(child, true),
                                                        ),
                                                ],
                                            )}
                                    </TableBody>
                                </Table>
                            </div>
                        ) : (
                            <Empty>
                                <EmptyHeader>
                                    <EmptyTitle>
                                        {filters.search
                                            ? 'Nessun risultato per la ricerca'
                                            : 'Nessun Centro di Costo'}
                                    </EmptyTitle>
                                    <EmptyDescription>
                                        {filters.search
                                            ? 'Nessun centro corrisponde alla ricerca.'
                                            : 'Crea il primo Centro di Costo per categorizzare i tuoi elementi.'}
                                    </EmptyDescription>
                                </EmptyHeader>
                            </Empty>
                        )}
                    </CardContent>
                </Card>
                <Pagination page={records} />
            </div>
            <AlertDialog
                open={deleting !== null}
                onOpenChange={(open) => {
                    if (!open && !busy) setDeleting(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>
                            {confirmCascade
                                ? 'Conferma eliminazione di padre e figli'
                                : `Eliminare ${deleting?.name}?`}
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                            {confirmCascade
                                ? 'Verranno eliminati il padre e tutti i suoi figli, insieme alle loro associazioni. Puoi annullare l’eliminazione con Ctrl+Z.'
                                : 'Le associazioni di questo centro saranno rimosse. Spese, progetti e contratti resteranno disponibili.'}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {hasChildren && !confirmCascade && (
                        <Field orientation="horizontal">
                            <Checkbox
                                id="delete-center-children"
                                checked={deleteChildren}
                                onCheckedChange={(checked) =>
                                    setDeleteChildren(checked === true)
                                }
                                disabled={busy}
                            />
                            <div className="flex flex-col gap-1">
                                <FieldLabel htmlFor="delete-center-children">
                                    Elimina anche i figli e le loro associazioni
                                </FieldLabel>
                                <FieldDescription>
                                    Se non selezioni questa opzione, i figli
                                    saranno conservati come centri indipendenti
                                    con tutte le loro associazioni.
                                </FieldDescription>
                            </div>
                        </Field>
                    )}
                    {confirmCascade && (
                        <p role="alert" className="text-sm text-destructive">
                            Saranno rimossi tutti i tag del padre e dei figli.
                            Spese, progetti e contratti non verranno eliminati.
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
                                void remove();
                            }}
                        >
                            {busy
                                ? 'Eliminazione…'
                                : deleteChildren &&
                                    hasChildren &&
                                    !confirmCascade
                                  ? 'Continua'
                                  : 'Elimina'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
}

CostCenters.layout = {
    breadcrumbs: [{ title: 'Centri di Costo', href: '/dashboard' }],
};
