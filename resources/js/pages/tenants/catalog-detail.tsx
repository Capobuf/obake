import {
    DetailHero,
    DetailEditAction,
} from '@/components/management/detail-hero';
import { CommentsSection } from '@/components/management/comments-section';
import { ProjectStatusSelect } from '@/components/management/project-status-select';
import {
    ArrowUpRight,
    ChevronDown,
    FileText,
    FolderKanban,
    Plus,
} from 'lucide-react';
import {
    InlineEdit,
    saveInlineRecord,
} from '@/components/management/inline-edit';
import { SpreadsheetActions } from '@/components/management/spreadsheet-actions';
import { Head, Link, router } from '@inertiajs/react';
import { useRef, useState } from 'react';
import { AttachmentsSection } from '@/components/management/attachments-section';
import { DeleteRecord } from '@/components/management/delete-record';
import { CostCenterTags } from '@/components/management/cost-center-tags';
import {
    DashboardFilters,
    applyFilters,
} from '@/components/management/dashboard-filters';
import { ExpenseTable } from '@/components/management/expense-table';
import { LinkProjectExpense } from '@/components/management/link-project-expense';
import { DetailBreakdownChart } from '@/components/management/detail-breakdown-chart';
import { DetailNotes } from '@/components/management/detail-notes';
import { dateLabel } from '@/components/management/helpers';
import { Pagination } from '@/components/management/pagination';
import { DashboardSummary } from '@/components/management/dashboard-summary';
import type { SummaryAnalytics } from '@/components/management/dashboard-summary';
import { labels, projectStatusLabel } from '@/components/management/types';
import type {
    Catalog,
    DetailBreakdown,
    Expense,
    Filters,
    Options,
    Pagination as Page,
    RecordData,
} from '@/components/management/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Tenant } from '@/types';
import { cn } from '@/lib/utils';

export default function CatalogDetail({
    tenant,
    catalog,
    record,
    options,
    expenses,
    analytics,
    breakdown,
    contracts,
    year,
    history,
    expenseFilters,
}: {
    tenant: Tenant;
    catalog: Catalog;
    record: RecordData;
    options: Options;
    expenses: Page<Expense>;
    analytics: SummaryAnalytics;
    breakdown: DetailBreakdown | null;
    contracts: Page<RecordData> | null;
    year: number;
    history: boolean;
    expenseFilters: Filters;
}) {
    const [tableBusy, setTableBusy] = useState(false);
    const [linkExpenseOpen, setLinkExpenseOpen] = useState(false);
    const addExpenseButton = useRef<HTMLButtonElement>(null);
    const path = `/t/${tenant.slug}/${catalog}`;
    const save = (field: string, value: unknown) =>
        saveInlineRecord(`${path}/${record.id}`, { [field]: value });
    const info =
        catalog === 'vendors'
            ? [
                  ['Partita IVA', 'vat_number', record.vat_number],
                  ['Email', 'email', record.email],
                  ['Telefono', 'phone', record.phone],
              ]
            : catalog === 'projects'
              ? [
                    ['Data iniziale', 'starts_on', record.starts_on],
                    ['Data finale', 'ends_on', record.ends_on],
                    ['Stato', 'status', record.status],
                ]
              : [];
    const economics = (
        <>
            <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <h2 className="font-semibold">
                        Totali delle spese collegate · {year}
                    </h2>
                </div>
                <DashboardSummary
                    analytics={analytics}
                    year={year}
                    scope={catalog === 'projects' ? 'project' : 'expenses'}
                />
            </div>
            {breakdown && (
                <DetailBreakdownChart
                    key={`${tenant.slug}:${catalog}:${record.id}:${year}:${history}`}
                    breakdown={breakdown}
                    getHref={(id) =>
                        /^\d+$/.test(id)
                            ? `/t/${tenant.slug}/expenses/${id}`
                            : undefined
                    }
                />
            )}
            <section
                aria-label="Spese collegate"
                className="flex min-w-0 flex-col gap-3"
            >
                <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="font-semibold">
                        Spese collegate · {history ? 'Tutti gli anni' : year}
                    </h2>
                </div>
                <ExpenseTable
                    key={`${tenant.id}:${catalog}:${record.id}:${year}:${history}`}
                    toolbar={
                        <DashboardFilters
                            tenant={tenant}
                            expenses={expenses}
                            filters={expenseFilters}
                            options={options}
                            path={`${path}/${record.id}`}
                            busy={tableBusy}
                            hideRelations={[catalog]}
                            contractMode={catalog === 'contracts'}
                            onCreate={
                                catalog === 'contracts'
                                    ? () =>
                                          router.visit(
                                              `/t/${tenant.slug}/expenses/create?contract_id=${record.id}&year=${year}`,
                                          )
                                    : undefined
                            }
                            createAction={
                                catalog === 'projects' ? (
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                ref={addExpenseButton}
                                                className="w-full sm:ml-auto sm:w-auto"
                                                disabled={tableBusy}
                                            >
                                                <Plus data-icon="inline-start" />
                                                Aggiungi spesa
                                                <ChevronDown data-icon="inline-end" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent
                                            align="end"
                                            onCloseAutoFocus={(event) => {
                                                if (linkExpenseOpen)
                                                    event.preventDefault();
                                            }}
                                        >
                                            <DropdownMenuGroup>
                                                <DropdownMenuItem
                                                    disabled={tableBusy}
                                                    onSelect={() =>
                                                        router.visit(
                                                            `/t/${tenant.slug}/expenses/create?project_id=${record.id}&year=${year}`,
                                                        )
                                                    }
                                                >
                                                    Nuova Spesa
                                                </DropdownMenuItem>
                                                <DropdownMenuItem
                                                    disabled={tableBusy}
                                                    onSelect={() =>
                                                        setLinkExpenseOpen(true)
                                                    }
                                                >
                                                    Spesa Esistente
                                                </DropdownMenuItem>
                                            </DropdownMenuGroup>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                ) : undefined
                            }
                        />
                    }
                    filters={expenseFilters}
                    onSort={(sort) =>
                        applyFilters(`${path}/${record.id}`, {
                            ...expenseFilters,
                            sort,
                            direction:
                                expenseFilters.sort === sort &&
                                expenseFilters.direction === 'asc'
                                    ? 'desc'
                                    : 'asc',
                        })
                    }
                    rows={expenses.data}
                    slug={tenant.slug}
                    options={options}
                    hideRelations={[catalog]}
                    showYear
                    contractMode={catalog === 'contracts'}
                    projectId={catalog === 'projects' ? record.id : undefined}
                    onBusyChange={setTableBusy}
                />
                {catalog === 'projects' && (
                    <LinkProjectExpense
                        slug={tenant.slug}
                        project={record}
                        open={linkExpenseOpen}
                        onOpenChange={setLinkExpenseOpen}
                        onCloseAutoFocus={(event) => {
                            event.preventDefault();
                            addExpenseButton.current?.focus();
                        }}
                    />
                )}
                <div
                    onClickCapture={(event) => {
                        if (tableBusy) {
                            event.preventDefault();
                            event.stopPropagation();
                        }
                    }}
                >
                    <Pagination page={expenses} />
                </div>
            </section>
        </>
    );
    const hasHero = catalog === 'contracts' || catalog === 'projects';
    const breadcrumb = (
        <Link
            href={path}
            className={cn(
                'text-sm text-muted-foreground',
                hasHero && 'mt-2 inline-block hover:text-foreground',
            )}
        >
            {tenant.name} / {labels[catalog]}
        </Link>
    );
    const headerContent = (
        <>
            {!hasHero && breadcrumb}
            <InlineEdit
                value={record.name}
                display={record.display_name ?? record.name}
                label="Nome"
                disabled={tableBusy}
                as="h1"
                className={cn(
                    'page-title [overflow-wrap:anywhere]',
                    !hasHero && 'mt-2',
                )}
                onSave={(value) => save('name', value)}
            />
            {hasHero && breadcrumb}
            {catalog === 'contracts' && (
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                    <span>Periodo:</span>
                    {(['starts_on', 'ends_on'] as const).map((field, index) => (
                        <div
                            key={field}
                            className="flex min-w-0 items-center gap-2"
                        >
                            {index === 1 && <span aria-hidden="true">–</span>}
                            <InlineEdit
                                value={record[field]}
                                label={
                                    field === 'starts_on'
                                        ? 'Inizio contratto'
                                        : 'Fine contratto'
                                }
                                type="date"
                                display={
                                    record[field]
                                        ? dateLabel(record[field])
                                        : 'Non indicata'
                                }
                                className="w-auto tabular-nums"
                                disabled={tableBusy}
                                onSave={(value) => save(field, value || null)}
                            />
                        </div>
                    ))}
                </div>
            )}
            {catalog === 'projects' && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <InlineEdit
                        value={record.status}
                        label="Stato del progetto"
                        activation="click"
                        disabled={tableBusy}
                        className="w-auto"
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
                                statuses={options.project_statuses}
                                value={value}
                                onChange={onChange}
                                disabled={disabled}
                                invalid={invalid}
                                autoFocus
                                onCancel={onCancel}
                            />
                        )}
                        onSave={(value) => save('status', value || null)}
                    />
                </div>
            )}
        </>
    );
    const headerActions = (
        <>
            {catalog === 'projects' && (
                <Badge variant="secondary">{year}</Badge>
            )}
            {hasHero ? (
                <DetailEditAction
                    href={`${path}/${record.id}/edit`}
                    label={
                        catalog === 'contracts'
                            ? 'Modifica contratto'
                            : 'Modifica progetto'
                    }
                    disabled={tableBusy}
                />
            ) : (
                <DeleteRecord
                    url={`${path}/${record.id}`}
                    redirect={path}
                    label={record.display_name ?? record.name ?? ''}
                    disabled={tableBusy}
                />
            )}
            <SpreadsheetActions
                slug={tenant.slug}
                resource={catalog}
                label={labels[catalog]}
                filters={{
                    record: record.id,
                    year,
                }}
                exportOnly
                disabled={tableBusy}
            />
        </>
    );
    return (
        <>
            <Head
                title={`${record.display_name ?? record.name} · ${tenant.name}`}
            />
            <div className="@container/detail page-shell detail-enter">
                {hasHero ? (
                    <DetailHero
                        icon={catalog === 'contracts' ? FileText : FolderKanban}
                        accent={
                            catalog === 'contracts' ? 'contract' : 'project'
                        }
                        actions={headerActions}
                    >
                        {headerContent}
                    </DetailHero>
                ) : (
                    <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0 flex-1">{headerContent}</div>
                        <div className="flex shrink-0 flex-wrap items-center gap-2">
                            {headerActions}
                        </div>
                    </header>
                )}
                {catalog !== 'vendors' && economics}
                <Card className="min-w-0 gap-4">
                    <CardHeader>
                        <CardTitle>Informazioni</CardTitle>
                    </CardHeader>
                    <CardContent className="min-w-0">
                        <dl className="grid gap-5 sm:grid-cols-3">
                            {info.map(([label, field, value]) => (
                                <div key={label}>
                                    <dt className="text-sm text-muted-foreground">
                                        {label}
                                    </dt>
                                    <dd className="mt-1 text-sm font-medium">
                                        <InlineEdit
                                            value={value}
                                            label={label!}
                                            disabled={tableBusy}
                                            type={
                                                field?.endsWith('_on')
                                                    ? 'date'
                                                    : field === 'email'
                                                      ? 'email'
                                                      : 'text'
                                            }
                                            display={
                                                field?.endsWith('_on')
                                                    ? dateLabel(value)
                                                    : field === 'status'
                                                      ? projectStatusLabel(
                                                            value,
                                                            options.project_statuses,
                                                        )
                                                      : value || 'Da inserire'
                                            }
                                            renderEditor={
                                                field === 'status'
                                                    ? ({
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
                                                              value={value}
                                                              onChange={
                                                                  onChange
                                                              }
                                                              disabled={
                                                                  disabled
                                                              }
                                                              invalid={invalid}
                                                              autoFocus
                                                              onCancel={
                                                                  onCancel
                                                              }
                                                          />
                                                      )
                                                    : undefined
                                            }
                                            onSave={(value) =>
                                                save(field!, value || null)
                                            }
                                        />
                                    </dd>
                                </div>
                            ))}
                            {catalog === 'contracts' && (
                                <div>
                                    <dt className="text-sm text-muted-foreground">
                                        Fornitore
                                    </dt>
                                    <dd className="mt-1 flex items-center gap-2">
                                        <InlineEdit
                                            value={
                                                record.vendor_id == null
                                                    ? ''
                                                    : String(record.vendor_id)
                                            }
                                            label="Fornitore"
                                            disabled={tableBusy}
                                            display={
                                                record.vendor?.name ??
                                                'Senza fornitore'
                                            }
                                            choices={[
                                                {
                                                    value: '',
                                                    label: 'Senza fornitore',
                                                },
                                                ...options.vendors.map(
                                                    (vendor) => ({
                                                        value: String(
                                                            vendor.id,
                                                        ),
                                                        label: vendor.name,
                                                    }),
                                                ),
                                            ]}
                                            onSave={(value) =>
                                                save(
                                                    'vendor_id',
                                                    value
                                                        ? Number(value)
                                                        : null,
                                                )
                                            }
                                        />
                                        {record.vendor && (
                                            <Button
                                                asChild
                                                variant="ghost"
                                                size="icon"
                                            >
                                                <Link
                                                    aria-label={`Apri ${record.vendor.name}`}
                                                    href={`/t/${tenant.slug}/vendors/${record.vendor.id}`}
                                                >
                                                    <ArrowUpRight />
                                                </Link>
                                            </Button>
                                        )}
                                    </dd>
                                </div>
                            )}
                            {catalog !== 'vendors' &&
                                !!record.cost_centers?.length && (
                                    <div
                                        className={cn(
                                            'min-w-0',
                                            catalog === 'contracts'
                                                ? 'sm:col-span-2'
                                                : 'sm:col-span-3',
                                        )}
                                    >
                                        <dt className="text-sm text-muted-foreground">
                                            Centri di Costo
                                        </dt>
                                        <dd className="mt-2">
                                            <CostCenterTags
                                                centers={record.cost_centers}
                                            />
                                        </dd>
                                    </div>
                                )}
                        </dl>
                        {catalog === 'projects' && (
                            <p className="mt-4 text-sm text-muted-foreground">
                                Gli importi allocati ed effettivi del progetto
                                sono la somma delle spese collegate.
                            </p>
                        )}
                    </CardContent>
                </Card>
                {
                    <DetailNotes
                        key={record.id}
                        text={record.notes ?? record.description ?? ''}
                        title={catalog === 'projects' ? 'Descrizione' : 'Note'}
                        disabled={tableBusy}
                        onSave={(value) =>
                            save(
                                catalog === 'projects'
                                    ? 'description'
                                    : 'notes',
                                value || null,
                            )
                        }
                    />
                }
                <CommentsSection
                    key={`comments:${tenant.id}:${catalog}:${record.id}`}
                    tenant={tenant}
                    resource={catalog}
                    recordId={record.id}
                />
                {catalog !== 'vendors' && (
                    <AttachmentsSection
                        compact
                        key={`${tenant.id}:${catalog}:${record.id}`}
                        tenant={tenant}
                        resource={catalog}
                        recordId={record.id}
                    />
                )}
                {catalog === 'vendors' && economics}
                {contracts && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Contratti collegati</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {contracts.data.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                    Nessun contratto collegato a questo
                                    fornitore.
                                </p>
                            ) : (
                                <div className="space-y-3">
                                    {contracts.data.map((contract) => (
                                        <Link
                                            key={contract.id}
                                            className="flex justify-between rounded-lg border p-3 text-sm hover:bg-accent"
                                            href={`/t/${tenant.slug}/contracts/${contract.id}`}
                                        >
                                            <span>
                                                {contract.display_name ??
                                                    contract.name}
                                            </span>
                                            <Badge variant="secondary">
                                                {dateLabel(contract.ends_on)}
                                            </Badge>
                                        </Link>
                                    ))}
                                </div>
                            )}
                            <Pagination page={contracts} />
                        </CardContent>
                    </Card>
                )}
            </div>
        </>
    );
}
CatalogDetail.layout = {
    breadcrumbs: [{ title: 'Dettaglio', href: '/dashboard' }],
};
