import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    ReferenceLine,
    XAxis,
    YAxis,
} from 'recharts';
import { compactMoney, topGroups } from './analytics-helpers';
import type { EconomicGroup } from './analytics-types';
import type { BudgetSnapshot } from './budget-types';
import { money } from './helpers';

export type BudgetReportChartKind =
    | 'distribution'
    | 'projects'
    | 'contracts'
    | 'variances';
const colors = ['#637fa9', '#aa7744'];

// Vendor totals use the same server accounting as the Budget; source charts use its attributed entries.
export function budgetReportGroups(
    budget: BudgetSnapshot,
    kind: 'vendors' | 'projects' | 'contracts',
): EconomicGroup[] {
    if (kind === 'vendors')
        return Object.entries(budget.vendor_groups).map(([id, totals]) => ({
            ...totals,
            id,
        }));
    return budget.entries
        .filter(
            (entry) =>
                entry.type === (kind === 'projects' ? 'project' : 'contract'),
        )
        .map((entry) => ({ ...entry, name: entry.description, count: 1 }));
}

export function budgetReportVariances(budget: BudgetSnapshot): EconomicGroup[] {
    const comparable = budget.entries.filter(
        (entry) => entry.variance !== null,
    );
    return [
        ...comparable
            .filter((entry) => Number(entry.variance) > 0)
            .toSorted(
                (a, b) =>
                    Number(b.variance) - Number(a.variance) || a.id - b.id,
            )
            .slice(0, 5),
        ...comparable
            .filter((entry) => Number(entry.variance) < 0)
            .toSorted(
                (a, b) =>
                    Number(a.variance) - Number(b.variance) || a.id - b.id,
            )
            .slice(0, 5),
    ].map((entry) => ({ ...entry, name: entry.description, count: 1 }));
}

export function BudgetReportChart({
    kind,
    budget,
    width,
}: {
    kind: BudgetReportChartKind;
    budget: BudgetSnapshot;
    width: number;
}) {
    const rows =
        kind === 'variances'
            ? budgetReportVariances(budget)
            : topGroups(
                  budgetReportGroups(
                      budget,
                      kind === 'distribution' ? 'vendors' : kind,
                  ),
                  10,
                  'actual',
              );
    if (!rows.length)
        return (
            <p>
                Nessuna voce{' '}
                {kind === 'variances'
                    ? 'con scostamento diverso da zero'
                    : 'inclusa'}{' '}
                nel report.
            </p>
        );
    const metrics =
        kind === 'variances'
            ? (['variance'] as const)
            : (['allocated', 'actual'] as const);
    const values = rows.flatMap((row) =>
        metrics.flatMap((metric) =>
            row[metric] === null ? [] : [Number(row[metric])],
        ),
    );
    const domain: [number, number] = [
        Math.min(0, ...values),
        Math.max(0, ...values),
    ];
    // Small chart batches remain intact on an A4 page; the table carries full labels and exact amounts.
    return (
        <>
            <p className="budget-report-note">
                {kind === 'variances'
                    ? 'Fino a 5 maggiori sforamenti e 5 maggiori risparmi, come nella panoramica.'
                    : 'Prime 10 voci per effettivo; le restanti sono aggregate in «Altri», come nella panoramica.'}
            </p>
            {Array.from({ length: Math.ceil(rows.length / 6) }, (_, page) => {
                const batch = rows.slice(page * 6, page * 6 + 6);
                const data = batch.map((row, index) => ({
                    label: `${page * 6 + index + 1}`,
                    allocated:
                        row.allocated === null ? null : Number(row.allocated),
                    actual: row.actual === null ? null : Number(row.actual),
                    variance:
                        row.variance === null ? null : Number(row.variance),
                }));
                return (
                    <div className="budget-report-chart-batch" key={page}>
                        <p className="budget-report-note">
                            {kind === 'variances'
                                ? 'Scostamento'
                                : 'Allocato (blu) · Effettivo (ocra)'}{' '}
                            · voci {page * 6 + 1}–{page * 6 + batch.length}
                        </p>
                        <div className="budget-report-block">
                            <BarChart
                                width={width}
                                height={batch.length * 30 + 40}
                                data={data}
                                layout="vertical"
                                margin={{
                                    left: 0,
                                    right: 30,
                                    top: 5,
                                    bottom: 5,
                                }}
                            >
                                <CartesianGrid
                                    horizontal={false}
                                    stroke="#dbe3ed"
                                />
                                <XAxis
                                    type="number"
                                    domain={domain}
                                    tickFormatter={compactMoney}
                                    tick={{ fill: '#52647d', fontSize: 11 }}
                                />
                                <YAxis
                                    dataKey="label"
                                    type="category"
                                    width={30}
                                    tick={{ fill: '#182841', fontSize: 11 }}
                                />
                                <ReferenceLine x={0} stroke="#52647d" />
                                {metrics.map((metric, index) => (
                                    <Bar
                                        key={metric}
                                        dataKey={metric}
                                        fill={colors[index]}
                                        isAnimationActive={false}
                                    >
                                        {metric === 'variance' &&
                                            batch.map((row) => (
                                                <Cell
                                                    key={row.id}
                                                    fill={
                                                        Number(row.variance) > 0
                                                            ? 'var(--finance-overrun)'
                                                            : 'var(--finance-saving)'
                                                    }
                                                />
                                            ))}
                                    </Bar>
                                ))}
                            </BarChart>
                        </div>
                        <table className="budget-report-distribution">
                            <thead>
                                <tr>
                                    <th scope="col">Voce</th>
                                    <th scope="col">Allocato</th>
                                    <th scope="col">Effettivo</th>
                                    {kind === 'variances' && (
                                        <th scope="col">Scostamento</th>
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {batch.map((row, index) => (
                                    <tr key={row.id}>
                                        <th scope="row">
                                            {page * 6 + index + 1}. {row.name}
                                        </th>
                                        <td>{money(row.allocated)}</td>
                                        <td>{money(row.actual)}</td>
                                        {kind === 'variances' && (
                                            <td>
                                                {row.variance === null
                                                    ? 'Non confrontabile'
                                                    : money(row.variance)}
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                );
            })}
        </>
    );
}
