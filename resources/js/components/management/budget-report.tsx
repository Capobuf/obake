import type { Ref } from 'react';
import { ReportDocument, defaultPrintReportOptions } from './report-document';
import type { PrintReportOptions } from './report-document';
import {
    ChartNoAxesCombined,
    GitFork,
    TableProperties,
    Building2,
    FolderKanban,
    FileText,
    TrendingUp,
    Table2,
    Sigma,
} from 'lucide-react';
import type { Row, Table } from '@tanstack/react-table';
import { BudgetSankey } from './budget-sankey';
import { BudgetReportChart } from './budget-report-charts';
import { budgetLabels, budgetTypes } from './budget-types';
import type { BudgetEntry, BudgetSnapshot, BudgetTotals } from './budget-types';
import { money } from './helpers';

export const budgetReportColumns = {
    description: 'Descrizione',
    type: 'Tipo',
    vendor: 'Fornitore',
    center: 'Centro di costo',
    allocated: 'Allocato',
    actual: 'Effettivo',
    variance: 'Scostamento',
};
export const budgetReportBlocks = {
    kpis: 'Riepilogo economico',
    sankey: 'Ripartizione del Budget',
    reconciliation: 'Importi della ripartizione',
    distribution: 'Distribuzione Fornitore',
    projects: 'Allocato ed effettivo per progetto',
    contracts: 'Allocato ed effettivo per contratto',
    variances: 'Principali sforamenti e risparmi',
    table: 'Voci del Budget',
    totals: 'Totale delle voci incluse nel report',
};
export const budgetReportIcons = {
    kpis: ChartNoAxesCombined,
    sankey: GitFork,
    reconciliation: TableProperties,
    distribution: Building2,
    projects: FolderKanban,
    contracts: FileText,
    variances: TrendingUp,
    table: Table2,
    totals: Sigma,
};
export type BudgetReportColumn = keyof typeof budgetReportColumns;
export type BudgetReportBlock = keyof typeof budgetReportBlocks;
export type BudgetReportData = {
    budget: BudgetSnapshot;
    filters: string[];
};
export type BudgetReportOptions = PrintReportOptions<
    BudgetReportBlock,
    BudgetReportColumn
>;
export function defaultBudgetReportOptions(
    tenantName: string,
): BudgetReportOptions {
    return {
        ...defaultPrintReportOptions(
            tenantName,
            'Budget annuale',
            budgetReportColumns,
            budgetReportBlocks,
        ),
        groupByType: true,
    };
}

export function captureBudgetReport(
    table: Table<BudgetEntry>,
    summary: BudgetSnapshot,
    filters: string[],
): BudgetReportData {
    const entries = new Map(summary.entries.map((entry) => [entry.id, entry]));
    // Sorted leaves include collapsed groups, independently of selection/pagination.
    const leaves = (rows: Row<BudgetEntry>[]): Row<BudgetEntry>[] =>
        rows.flatMap((row) =>
            row.getIsGrouped() ? leaves(row.subRows) : [row],
        );
    const rows = leaves(table.getSortedRowModel().rows);
    return {
        budget: {
            ...summary,
            entries: rows.map((row) => {
                const entry = entries.get(row.original.id);
                if (!entry)
                    throw new Error(
                        'Dati del Budget cambiati. Aggiorna il Budget prima di stampare.',
                    );
                return entry;
            }),
        },
        filters,
    };
}

function amount(value: string | null, variance = false) {
    return value === null && variance ? 'Non confrontabile' : money(value);
}
function reportCell(entry: BudgetEntry, column: BudgetReportColumn) {
    switch (column) {
        case 'variance':
            return money(entry.variance);
        case 'description':
            return (
                <>
                    {entry.description}
                    {entry.estimated_count > 0 && <small>Solo stima</small>}
                    {entry.allocated === null && entry.actual === null && (
                        <small>Non valorizzato</small>
                    )}
                </>
            );
        case 'type':
            return budgetLabels[entry.type];
        case 'vendor':
            return entry.vendor?.name ?? 'Senza fornitore';
        case 'center':
            return entry.cost_center?.name ?? 'Senza centro di costo';
        default:
            return amount(entry[column]);
    }
}
const metrics = ['allocated', 'actual', 'variance'] as const;
function ReportTotals({ totals }: { totals: BudgetTotals }) {
    return (
        <dl className="budget-report-kpis">
            {metrics.map((metric) => (
                <div key={metric} data-metric={metric}>
                    <dt>{budgetReportColumns[metric]}</dt>
                    <dd>{amount(totals[metric], metric === 'variance')}</dd>
                </div>
            ))}
        </dl>
    );
}
export function BudgetReport({
    data,
    options,
    tenantName,
    logoUrl,
    year,
    createdAt,
    ref,
}: {
    data: BudgetReportData;
    options: BudgetReportOptions;
    tenantName: string;
    logoUrl?: string | null;
    year: number;
    createdAt: string;
    ref?: Ref<HTMLElement>;
}) {
    const { budget } = data;
    const width = options.orientation === 'portrait' ? 680 : 1008;
    const flowMetrics =
        options.sankeyMetric === 'both'
            ? (['allocated', 'actual'] as const)
            : [options.sankeyMetric];
    const reconciliationMetrics =
        options.reconciliationMetric === 'both'
            ? (['allocated', 'actual'] as const)
            : [options.reconciliationMetric];
    const groups = options.groupByType
        ? budgetTypes.map((type) => ({
              id: type,
              name: budgetLabels[type],
              entries: budget.entries.filter((entry) => entry.type === type),
              totals: budget.groups[type],
          }))
        : [
              {
                  id: 'all',
                  name: '',
                  entries: budget.entries,
                  totals: budget.totals,
              },
          ];
    const renderBlock = (block: BudgetReportBlock) => {
        const Icon = budgetReportIcons[block];
        const heading = (
            <h2>
                <Icon aria-hidden="true" />
                {options.titles[block]}
            </h2>
        );
        switch (block) {
            case 'kpis':
            case 'totals':
                return (
                    <>
                        {heading}
                        <div
                            className={
                                block === 'totals'
                                    ? 'budget-report-totals'
                                    : undefined
                            }
                        >
                            <ReportTotals totals={budget.totals} />
                        </div>
                    </>
                );
            case 'sankey':
                return (
                    <>
                        {flowMetrics.map((metric, index) => (
                            <div key={metric} className="budget-report-block">
                                {index === 0 && heading}
                                <h3>{budgetReportColumns[metric]}</h3>
                                <BudgetSankey
                                    budget={budget}
                                    printWidth={width}
                                    printMetric={metric}
                                />
                            </div>
                        ))}
                        <p className="budget-report-note">
                            I grafici rappresentano i soli flussi positivi.
                            Rettifiche negative e importi mancanti non generano
                            flussi.
                        </p>
                    </>
                );
            case 'reconciliation':
                return (
                    <>
                        {reconciliationMetrics.map((metric, index) => (
                            <div key={metric} className="budget-report-block">
                                {index === 0 && heading}
                                <h3>{budgetReportColumns[metric]}</h3>
                                <table className="budget-report-distribution">
                                    <thead>
                                        <tr>
                                            <th scope="col">Tipo</th>
                                            <th scope="col">Flussi positivi</th>
                                            <th scope="col">
                                                Rettifiche negative
                                            </th>
                                            <th scope="col">
                                                {budgetReportColumns[metric]}{' '}
                                                netto
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {budgetTypes.map((type) => (
                                            <tr key={type}>
                                                <th scope="row">
                                                    {budgetLabels[type]}
                                                </th>
                                                <td>
                                                    {money(
                                                        budget.groups[type][
                                                            `${metric}_positive`
                                                        ],
                                                    )}
                                                </td>
                                                <td>
                                                    {money(
                                                        budget.groups[type][
                                                            `${metric}_negative`
                                                        ],
                                                    )}
                                                </td>
                                                <td>
                                                    {money(
                                                        budget.groups[type][
                                                            metric
                                                        ],
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ))}
                    </>
                );
            case 'table':
                return budget.entries.length === 0 ? (
                    <div className="budget-report-block">
                        {heading}
                        <p>Nessuna voce corrisponde ai filtri selezionati.</p>
                    </div>
                ) : (
                    <>
                        {groups
                            .filter((group) => group.entries.length > 0)
                            .map((group, index) => (
                                <div
                                    key={group.id}
                                    className="budget-report-block budget-report-entry-group"
                                >
                                    {index === 0 && heading}
                                    {group.name && (
                                        <h3 className="budget-report-group-title">
                                            {group.name}
                                        </h3>
                                    )}
                                    <table className="budget-report-entries">
                                        <thead>
                                            <tr>
                                                {options.columns.map(
                                                    (column) => (
                                                        <th
                                                            scope="col"
                                                            key={column}
                                                            data-column={column}
                                                        >
                                                            {
                                                                budgetReportColumns[
                                                                    column
                                                                ]
                                                            }
                                                        </th>
                                                    ),
                                                )}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {group.entries.map((entry) => (
                                                <tr
                                                    key={entry.id}
                                                    data-entry-id={entry.id}
                                                >
                                                    {options.columns.map(
                                                        (column) => (
                                                            <td
                                                                key={column}
                                                                data-column={
                                                                    column
                                                                }
                                                            >
                                                                {reportCell(
                                                                    entry,
                                                                    column,
                                                                )}
                                                            </td>
                                                        ),
                                                    )}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                    {options.groupByType &&
                                        options.subtotals && (
                                            <div className="budget-report-block budget-report-subtotal">
                                                <h3>
                                                    Subtotale · {group.name} ·
                                                    voci incluse
                                                </h3>
                                                <ReportTotals
                                                    totals={group.totals}
                                                />
                                            </div>
                                        )}
                                </div>
                            ))}
                    </>
                );
            default:
                return (
                    <BudgetReportChart
                        heading={heading}
                        kind={block}
                        budget={budget}
                        width={width}
                    />
                );
        }
    };
    return (
        <ReportDocument
            ref={ref}
            options={options}
            tenantName={tenantName}
            logoUrl={logoUrl}
            year={year}
            createdAt={createdAt}
            filters={data.filters}
            label="Budget"
            counts={
                <>
                    <strong>{budget.entries.length}</strong> righe nel report ·{' '}
                    <strong>{budget.totals.count}</strong> voci incluse nei
                    totali · <strong>{budget.totals.estimated_count}</strong>{' '}
                    solo stima
                </>
            }
        >
            {options.blocks
                .filter((block) => !options.hiddenBlocks.includes(block))
                .map((block) => {
                    return (
                        <section
                            key={block}
                            data-report-block={block}
                            aria-label={options.titles[block]}
                            className={
                                block === 'kpis' || block === 'totals'
                                    ? 'budget-report-block'
                                    : undefined
                            }
                        >
                            {renderBlock(block)}
                        </section>
                    );
                })}
        </ReportDocument>
    );
}
