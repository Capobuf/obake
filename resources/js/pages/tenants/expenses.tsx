import { ReceiptText } from 'lucide-react';
import { DetailHero } from '@/components/management/detail-hero';
import { Head } from '@inertiajs/react';
import { useState } from 'react';
import { SpreadsheetActions } from '@/components/management/spreadsheet-actions';
import { ExpenseWorkspace } from '@/components/management/expense-workspace';
import { DashboardSummary } from '@/components/management/dashboard-summary';
import type { SummaryAnalytics } from '@/components/management/dashboard-summary';
import type { ExpensePageProps } from '@/components/management/types';

export default function Expenses(
    props: ExpensePageProps & { analytics: SummaryAnalytics },
) {
    const [busy, setBusy] = useState(false);
    return (
        <>
            <Head title={`Spese · ${props.tenant.name}`} />
            <div className="page-shell detail-enter">
                <DetailHero
                    icon={ReceiptText}
                    actions={
                        <SpreadsheetActions
                            slug={props.tenant.slug}
                            resource="expenses"
                            label="Spese"
                            filters={props.filters}
                            disabled={busy}
                        />
                    }
                >
                    <h1 className="page-title">Spese</h1>
                    <p className="mt-2 text-sm text-muted-foreground">
                        {props.tenant.name}
                    </p>
                </DetailHero>
                <DashboardSummary
                    analytics={props.analytics}
                    year={props.filters.year!}
                />
                <ExpenseWorkspace
                    key={`${props.tenant.slug}:${props.filters.year}`}
                    {...props}
                    onBusyChange={setBusy}
                />
            </div>
        </>
    );
}
Expenses.layout = { breadcrumbs: [{ title: 'Spese', href: '/dashboard' }] };
