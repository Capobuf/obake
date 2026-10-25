import { usePageRefresh } from '@/hooks/use-page-refresh';
import { Head } from '@inertiajs/react';
import type {
    EntityFilter,
    ExpenseAnalytics,
    GroupId,
} from '@/components/management/analytics-types';
import { AnnualComparisonChart } from '@/components/management/annual-comparison-chart';
import { AllocatedUsage } from '@/components/management/allocated-usage';
import { ContractExpiryChart } from '@/components/management/contract-expiry-chart';
import { DashboardFilters } from '@/components/management/dashboard-filters';
import { DashboardSummary } from '@/components/management/dashboard-summary';
import { DistributionChart } from '@/components/management/distribution-chart';
import { EconomicChart } from '@/components/management/economic-chart';
import { ExpenseSankey } from '@/components/management/expense-sankey';
import type { ExpensePageProps } from '@/components/management/types';
import { VarianceChart } from '@/components/management/variance-chart';

export default function TenantDashboard(
    props: ExpensePageProps & { analytics: ExpenseAnalytics },
) {
    const { tenant, filters, analytics } = props;
    const path = `/t/${tenant.slug}/dashboard`;
    const year = filters.year!;
    const refresh = usePageRefresh(path);
    // Reset chart selections only when the data scope changes, not its table order.
    const chartKey = JSON.stringify([
        tenant.id,
        year,
        filters.search?.trim() ?? '',
        filters.vendor_id ?? '',
        filters.contract_id ?? '',
        filters.project_id ?? '',
    ]);
    const recordHref = (field: EntityFilter, id: GroupId) => {
        if (typeof id !== 'number') return undefined;
        const catalog = {
            vendor_id: 'vendors',
            project_id: 'projects',
            contract_id: 'contracts',
        }[field];
        return `/t/${tenant.slug}/${catalog}/${id}?year=${year}`;
    };
    return (
        <>
            <Head title={`Panoramica · ${tenant.name}`} />
            <div
                className="page-shell dashboard-enter"
                aria-busy={refresh.pending}
            >
                <header>
                    <p className="text-sm font-medium text-muted-foreground">
                        {tenant.name} · {year}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                        <h1 className="mr-auto page-title">Panoramica</h1>
                        <DashboardFilters
                            key={`${tenant.slug}:${year}`}
                            {...props}
                            path={path}
                        />
                    </div>
                    <p
                        className="mt-2 min-h-5 text-sm text-muted-foreground"
                        role="status"
                    >
                        {refresh.visible ? 'Aggiornamento…' : ''}
                    </p>
                </header>
                <DashboardSummary analytics={analytics} year={year} />
                <section
                    className="flex min-w-0 flex-col gap-4"
                    aria-label="Confronto annuale"
                >
                    <div className="grid min-w-0 gap-4 xl:grid-cols-3">
                        <div className="min-w-0 xl:col-span-2">
                            <AnnualComparisonChart
                                key={`${chartKey}:annual`}
                                rows={analytics.annual}
                                year={year}
                            />
                        </div>
                        <AllocatedUsage values={analytics.current} />
                    </div>
                </section>
                <section
                    className="flex min-w-0 flex-col gap-4"
                    aria-labelledby="vendors"
                >
                    <h2 id="vendors" className="text-lg font-semibold">
                        Fornitori
                    </h2>
                    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
                        <DistributionChart
                            key={`${chartKey}:vendors-distribution`}
                            title="Distribuzione"
                            rows={analytics.vendors}
                            values={analytics.current}
                            vendorConcentration
                            getHref={(id) => recordHref('vendor_id', id)}
                        />
                        <EconomicChart
                            key={`${chartKey}:vendors-ranking`}
                            title="Classifica"
                            rows={analytics.vendors}
                            getHref={(id) => recordHref('vendor_id', id)}
                        />
                    </div>
                </section>
                <section
                    className="flex min-w-0 flex-col gap-4"
                    aria-label="Flussi economici"
                >
                    <ExpenseSankey
                        key={`${chartKey}:flows`}
                        analytics={analytics}
                        getHref={recordHref}
                    />
                </section>
                <section
                    className="flex min-w-0 flex-col gap-4"
                    aria-labelledby="projects-contracts"
                >
                    <h2
                        id="projects-contracts"
                        className="text-lg font-semibold"
                    >
                        Progetti e contratti
                    </h2>
                    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
                        <EconomicChart
                            key={`${chartKey}:projects`}
                            title="Progetti"
                            rows={analytics.projects}
                            getHref={(id) => recordHref('project_id', id)}
                        />
                        <DistributionChart
                            key={`${chartKey}:project-statuses`}
                            title="Distribuzione"
                            rows={analytics.projectStatuses}
                            showReconciliation={false}
                            values={analytics.current}
                        />
                    </div>
                    <div className="grid min-w-0 gap-4 xl:grid-cols-2">
                        <EconomicChart
                            key={`${chartKey}:contracts`}
                            title="Spese per Contratto"
                            rows={analytics.contracts}
                            getHref={(id) => recordHref('contract_id', id)}
                        />
                        <ContractExpiryChart
                            key={`${chartKey}:expiry`}
                            expiry={analytics.expiry}
                            year={year}
                            slug={tenant.slug}
                        />
                    </div>
                </section>
                <section
                    className="flex min-w-0 flex-col gap-4"
                    aria-labelledby="critical"
                >
                    <h2 id="critical" className="text-lg font-semibold">
                        Scostamenti
                    </h2>
                    <VarianceChart
                        key={`${chartKey}:variances`}
                        rows={analytics.variances}
                        slug={tenant.slug}
                    />
                </section>
            </div>
        </>
    );
}
TenantDashboard.layout = {
    breadcrumbs: [{ title: 'Panoramica', href: '/dashboard' }],
};
