import { AnnualContractImport } from '@/components/management/annual-contract-import';
import { DetailHero } from '@/components/management/detail-hero';
import { SpreadsheetActions } from '@/components/management/spreadsheet-actions';
import { NewBudgetYearDialog } from '@/components/management/new-budget-year-dialog';
import { Head, router } from '@inertiajs/react';
import { useEffect, useRef, useState } from 'react';
import { ChartNoAxesCombined, Import, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { BudgetSankey } from '@/components/management/budget-sankey';
import {
    BudgetTable,
    type BudgetTableHandle,
} from '@/components/management/budget-table';
import {
    BudgetEntrySheet,
    BudgetMissingSheet,
} from '@/components/management/budget-entry-sheet';
import { EntityForm } from '@/components/management/entity-form';
import type { EntityFormHandle } from '@/components/management/entity-form';
import { api } from '@/components/management/helpers';
import { DashboardSummary } from '@/components/management/dashboard-summary';
import { budgetSummary } from '@/components/management/budget-types';
import type {
    BudgetProps,
    BudgetSnapshot,
    BudgetYear,
} from '@/components/management/budget-types';
import type { RecordData } from '@/components/management/types';
import { Button } from '@/components/ui/button';

import {
    Sheet,
    SheetContent,
    SheetHeader,
    SheetTitle,
    SheetDescription,
} from '@/components/ui/sheet';

import {
    Empty,
    EmptyHeader,
    EmptyTitle,
    EmptyDescription,
    EmptyContent,
} from '@/components/ui/empty';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Spinner } from '@/components/ui/spinner';
import { useDelayedBusy } from '@/hooks/use-delayed-busy';
import { usePageRefresh } from '@/hooks/use-page-refresh';

function BudgetHeader({
    props,
    busy,
    onPrintReport,
    getExportFilters,
}: {
    props: BudgetProps;
    busy: boolean;
    onPrintReport?: () => void;
    getExportFilters?: () => object | undefined;
}) {
    const visibleBusy = useDelayedBusy(busy);
    return (
        <DetailHero
            icon={ChartNoAxesCombined}
            accent="budget"
            actions={
                <>
                    <span role="status" className="flex w-5 items-center">
                        {visibleBusy && (
                            <>
                                <Spinner aria-hidden="true" />
                                <span className="sr-only">
                                    Aggiornamento Budget…
                                </span>
                            </>
                        )}
                    </span>
                    <SpreadsheetActions
                        slug={props.tenant.slug}
                        onPrintReport={onPrintReport}
                        getExportFilters={getExportFilters}
                        resource="budget"
                        label="Budget"
                        filters={{ year: props.selectedYear }}
                        disabled={busy}
                    />
                </>
            }
        >
            <h1 className="page-title">Budget</h1>
            <p className="mt-2 text-sm text-muted-foreground">
                {props.tenant.name}
            </p>
        </DetailHero>
    );
}

function BudgetWorkspace({
    props,
    year,
    initial,
    pending,
}: {
    props: BudgetProps;
    year: BudgetYear;
    initial: BudgetSnapshot;
    pending: boolean;
}) {
    const [budget, setBudget] = useState(initial);
    const [busy, setBusy] = useState(false);
    const [loading, setLoading] = useState(false);
    const [add, setAdd] = useState(false);
    const [missing, setMissing] = useState(false);
    const [importing, setImporting] = useState(false);
    const [error, setError] = useState('');
    const [editing, setEditing] = useState<RecordData | null>(null);
    const [expenseFormBusy, setExpenseFormBusy] = useState(false);
    const expenseForm = useRef<EntityFormHandle>(null);
    const budgetTable = useRef<BudgetTableHandle>(null);
    const lock = useRef(false);
    const base = `/t/${props.tenant.slug}/budget/years/${year.id}`;
    useEffect(() => {
        setBudget(initial);
    }, [initial]);
    useEffect(() => {
        const stop = router.on('before', (event) => {
            if (lock.current) event.preventDefault();
        });
        return stop;
    }, []);
    async function mutate(suffix: string, method: string, payload?: unknown) {
        if (lock.current) return false;
        lock.current = true;
        setBusy(true);
        try {
            const result = await api<{
                budget: BudgetSnapshot;
                message: string;
                reassigned: number[];
            }>(`${base}/${suffix}`, method, payload);
            setBudget(result.budget);
            setError('');
            toast.success(result.message, {
                description: result.reassigned.length
                    ? 'Le spese originali conservano i loro collegamenti.'
                    : undefined,
            });
            return true;
        } catch (failure) {
            const message =
                failure instanceof Error
                    ? failure.message
                    : 'Operazione non riuscita.';
            toast.error(message);
            return false;
        } finally {
            lock.current = false;
            setBusy(false);
        }
    }
    async function refresh() {
        setLoading(true);
        try {
            const result = await api<{ budget: BudgetSnapshot }>(base);
            setBudget(result.budget);
            setError('');
        } catch (failure) {
            const message =
                failure instanceof Error
                    ? failure.message
                    : 'Aggiornamento non riuscito.';
            setError(message);
        } finally {
            setLoading(false);
        }
    }
    async function saveRecord(
        resource: string,
        id: number,
        changes: Record<string, unknown>,
    ) {
        if (lock.current)
            throw new Error('Attendi il completamento dell’operazione.');
        lock.current = true;
        setBusy(true);
        try {
            await api(
                `/t/${props.tenant.slug}/${resource}/${id}`,
                'PATCH',
                changes,
            );
            await refresh();
        } finally {
            lock.current = false;
            setBusy(false);
        }
    }
    async function editExpense(id: number) {
        setLoading(true);
        try {
            const result = await api<{ record: RecordData }>(
                `/t/${props.tenant.slug}/budget/options?type=expense&id=${id}`,
            );
            setEditing(result.record);
        } catch (failure) {
            toast.error(
                failure instanceof Error
                    ? failure.message
                    : 'Spesa non disponibile.',
            );
        } finally {
            setLoading(false);
        }
    }
    const totals = budget.totals;
    return (
        <>
            <BudgetHeader
                props={props}
                busy={busy || loading || pending}
                onPrintReport={() => budgetTable.current?.printReport()}
                getExportFilters={() => budgetTable.current?.exportFilters()}
            />
            <section aria-label="Riepilogo budget">
                <DashboardSummary
                    analytics={budgetSummary(totals, props.previousBudget)}
                    year={year.year}
                    scope="budget"
                />
            </section>
            <BudgetSankey budget={budget} />
            <div className="flex flex-wrap items-center justify-end gap-3">
                <div className="flex flex-wrap gap-2">
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={busy || loading || pending}
                        onClick={() => setImporting(true)}
                    >
                        <Import data-icon="inline-start" />
                        Importa dall’anno precedente
                    </Button>
                    <Button
                        variant="outline"
                        size="sm"
                        disabled={busy || loading}
                        onClick={() => {
                            void refresh();
                        }}
                    >
                        <RefreshCw data-icon="inline-start" />
                        Aggiorna
                    </Button>
                </div>
            </div>
            {error && (
                <Alert variant="destructive">
                    <AlertTitle>Budget non aggiornato</AlertTitle>
                    <AlertDescription>
                        {error} Usa «Aggiorna» per riprovare.
                    </AlertDescription>
                </Alert>
            )}
            {budget.warnings?.map((warning) => (
                <Alert key={warning}>
                    <AlertTitle>Storico da verificare</AlertTitle>
                    <AlertDescription>{warning}</AlertDescription>
                </Alert>
            ))}
            <BudgetTable
                ref={budgetTable}
                tenantName={props.tenant.name}
                logoUrl={props.logoUrl}
                budgetYearId={year.id}
                budget={budget}
                slug={props.tenant.slug}
                year={year.year}
                centers={props.options.cost_centers}
                busy={busy || loading || pending}
                loading={loading || pending}
                mutate={mutate}
                onAdd={() => setAdd(true)}
                onMissing={() => setMissing(true)}
                onImport={() => setImporting(true)}
                onRecordSave={saveRecord}
                onExpenseEdit={(id) => {
                    void editExpense(id);
                }}
            />
            {importing && (
                <AnnualContractImport
                    path={base}
                    onClose={() => setImporting(false)}
                    onImported={setBudget}
                />
            )}
            <BudgetEntrySheet
                budgetYear={props.budgetYear!}
                open={add}
                onClose={() => setAdd(false)}
                slug={props.tenant.slug}
                entries={budget.entries}
                centers={props.options.cost_centers}
                busy={busy || loading || pending}
                mutate={mutate}
            />
            <BudgetMissingSheet
                open={missing}
                onClose={() => setMissing(false)}
                path={base}
                busy={busy || loading || pending}
                mutate={mutate}
            />
            <Sheet
                open={editing !== null}
                onOpenChange={(open) => {
                    if (!open) expenseForm.current?.requestClose();
                }}
            >
                <SheetContent
                    closeDisabled={expenseFormBusy}
                    className="w-full overflow-y-auto sm:max-w-5xl"
                    onEscapeKeyDown={(event) => event.preventDefault()}
                    onInteractOutside={(event) => event.preventDefault()}
                >
                    <SheetHeader>
                        <SheetTitle>Modifica spesa originale</SheetTitle>
                        <SheetDescription>
                            Dopo il salvataggio il Budget viene ricalcolato per
                            l’anno selezionato.
                        </SheetDescription>
                    </SheetHeader>
                    {editing && (
                        <EntityForm
                            ref={expenseForm}
                            key={editing.id}
                            tenant={props.tenant}
                            kind="expenses"
                            record={editing}
                            year={editing.year}
                            options={props.options}
                            onBusyChange={setExpenseFormBusy}
                            onClose={() => setEditing(null)}
                            onSaved={() => {
                                setEditing(null);
                                void refresh();
                            }}
                        />
                    )}
                </SheetContent>
            </Sheet>
        </>
    );
}

export default function Budget(props: BudgetProps) {
    const [newYear, setNewYear] = useState(false);
    const path = `/t/${props.tenant.slug}/budget`;
    const refresh = usePageRefresh(path);
    return (
        <>
            <Head
                title={`Budget ${props.selectedYear} · ${props.tenant.name}`}
            />
            <div
                className="page-shell detail-enter"
                aria-busy={refresh.pending}
            >
                {(!props.budgetYear || !props.budget) && (
                    <BudgetHeader props={props} busy={refresh.pending} />
                )}
                {props.budgetYear && props.budget ? (
                    <BudgetWorkspace
                        key={`${props.tenant.id}:${props.budgetYear.id}`}
                        props={props}
                        year={props.budgetYear}
                        initial={props.budget}
                        pending={refresh.pending}
                    />
                ) : (
                    <Empty className="min-h-80 border">
                        <EmptyHeader>
                            <EmptyTitle>
                                Il Budget {props.selectedYear} è da creare
                            </EmptyTitle>
                            <EmptyDescription>
                                Crea un anno vuoto e scegli le voci da
                                includere. Puoi aggiungere dati dagli archivi
                                oppure compilare voci libere.
                            </EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                            <Button onClick={() => setNewYear(true)}>
                                Crea Budget {props.selectedYear}
                            </Button>
                        </EmptyContent>
                    </Empty>
                )}
            </div>
            {newYear && (
                <NewBudgetYearDialog
                    slug={props.tenant.slug}
                    year={props.selectedYear}
                    onClose={() => setNewYear(false)}
                />
            )}
        </>
    );
}
Budget.layout = { breadcrumbs: [{ title: 'Budget', href: '/dashboard' }] };
