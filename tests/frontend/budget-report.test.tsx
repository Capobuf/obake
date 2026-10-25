import { describe, expect, it } from 'vite-plus/test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    createTable,
    getCoreRowModel,
    getFilteredRowModel,
    getGroupedRowModel,
    getSortedRowModel,
    getExpandedRowModel,
    getPaginationRowModel,
} from '@tanstack/react-table';
import {
    BudgetReport,
    captureBudgetReport,
    defaultBudgetReportOptions,
} from '../../resources/js/components/management/budget-report';
import {
    budgetReportGroups,
    budgetReportVariances,
} from '../../resources/js/components/management/budget-report-charts';
import type {
    BudgetEntry,
    BudgetSnapshot,
    BudgetTotals,
} from '../../resources/js/components/management/budget-types';

const totals: BudgetTotals = {
    allocated: '0.00',
    actual: null,
    variance: '0.00',
    count: 1,
    estimated_count: 1,
    comparable_count: 0,
    allocated_positive: '0.00',
    allocated_negative: '0.00',
    actual_positive: '0.00',
    actual_negative: '0.00',
};
const entries: BudgetEntry[] = [3, 2, 1].map((id) => ({
    ...totals,
    id,
    type: 'expense',
    source_id: id,
    description: `Voce ${id} <script>`,
    position: id,
    cost_center_id: null,
    cost_center: null,
    vendor: null,
    notes: null,
    starts_on: null,
    ends_on: null,
    expenses: [],
}));
const summary: BudgetSnapshot = {
    entries,
    totals,
    groups: { contract: totals, project: totals, expense: totals },
    cost_center_groups: {},
    vendor_groups: {},
    owners: {},
    has_missing_entries: false,
    warnings: [],
};
function table(search = '', sorted = true) {
    return createTable({
        data: entries,
        columns: [
            { accessorKey: 'description' },
            { accessorKey: 'type' },
            { accessorKey: 'allocated' },
            { id: 'actions' },
        ],
        state: {
            sorting: sorted ? [{ id: 'description', desc: false }] : [],
            grouping: ['type'],
            expanded: {},
            globalFilter: search,
            columnOrder: ['allocated', 'description', 'type', 'actions'],
            columnVisibility: { type: false },
            pagination: { pageIndex: 0, pageSize: 1 },
        },
        groupedColumnMode: false,
        onStateChange: () => {},
        renderFallbackValue: null,
        getCoreRowModel: getCoreRowModel(),
        getFilteredRowModel: getFilteredRowModel(),
        getGroupedRowModel: getGroupedRowModel(),
        getSortedRowModel: getSortedRowModel(),
        getExpandedRowModel: getExpandedRowModel(),
        getPaginationRowModel: getPaginationRowModel(),
    });
}

describe('Budget report', () => {
    it.each([0, 8])(
        'keeps one chart heading with its first content for %s entries',
        (count) => {
            const html = renderToStaticMarkup(
                <BudgetReport
                    data={{
                        budget: {
                            ...summary,
                            entries: Array.from({ length: count }, (_, id) => ({
                                ...entries[0],
                                id,
                                type: 'contract',
                            })),
                        },
                        filters: [],
                    }}
                    options={{
                        ...defaultBudgetReportOptions('Test'),
                        blocks: ['contracts'],
                    }}
                    tenantName="Test"
                    year={2026}
                    createdAt="25/10/2026"
                />,
            );
            expect(html).toMatch(/class="budget-report-block"><h2>/);
            expect(html.match(/<h2>/g)).toHaveLength(1);
            expect(html.match(/budget-report-chart-batch/g) ?? []).toHaveLength(
                count === 0 ? 0 : 2,
            );
        },
    );

    it.each([true, false])(
        'keeps the table title inside the first entry group (grouped=%s)',
        (groupByType) => {
            const html = renderToStaticMarkup(
                <BudgetReport
                    data={{ budget: summary, filters: [] }}
                    options={{
                        ...defaultBudgetReportOptions('Test'),
                        blocks: ['table'],
                        groupByType,
                    }}
                    tenantName="Test"
                    year={2026}
                    createdAt="25/10/2026"
                />,
            );
            expect(html).toMatch(
                /class="budget-report-block budget-report-entry-group"><h2>.*?Voci del Budget<\/h2>(?:<h3[^>]*>Spese singole<\/h3>)?<table/s,
            );
            expect(html.match(/<h2>/g)).toHaveLength(1);
            expect(html.match(/data-entry-id=/g)).toHaveLength(entries.length);
        },
    );

    it.each([
        [true, true],
        [true, false],
        [false, true],
        [false, false],
    ])(
        'previews page numbering enabled=%s and first page included=%s',
        (showPageNumbers, numberFirstPage) => {
            const html = renderToStaticMarkup(
                <BudgetReport
                    data={{ budget: summary, filters: [] }}
                    options={{
                        ...defaultBudgetReportOptions('Nirolabel'),
                        blocks: ['kpis'],
                        showPageNumbers,
                        numberFirstPage,
                    }}
                    tenantName="Nirolabel"
                    year={2026}
                    createdAt="20/10/2026"
                />,
            );
            const footer = html.match(/<footer\b[^>]*>(.*?)<\/footer>/s)![1];
            const pageNumber = footer.match(
                /<p\b[^>]*\bclass="[^"]*\bbudget-report-page-number\b[^"]*"[^>]*>(.*?)<\/p>/s,
            );
            expect(pageNumber !== null).toBe(showPageNumbers);
            if (showPageNumbers) {
                expect(pageNumber![1].replace(/<[^>]*>/g, '').trim()).toBe(
                    numberFirstPage ? '1' : '',
                );
            }
        },
    );
    it.each([
        [true, true],
        [true, false],
        [false, true],
        [false, false],
    ])(
        'renders footer branding=%s and date=%s independently',
        (showBranding, showDate) => {
            const html = renderToStaticMarkup(
                <BudgetReport
                    data={{ budget: summary, filters: [] }}
                    options={{
                        ...defaultBudgetReportOptions('Nirolabel'),
                        blocks: ['kpis'],
                        showBranding,
                        showDate,
                        showCompany: false,
                    }}
                    tenantName="Nirolabel"
                    year={2026}
                    createdAt="20/10/2026"
                />,
            );
            const footer = html.match(/<footer\b[^>]*>(.*?)<\/footer>/s)![1];
            expect(footer.includes('/branding/obake-logo-black.svg')).toBe(
                showBranding,
            );
            expect(footer.includes('Elaborato il 20/10/2026')).toBe(showDate);
            expect(footer).not.toContain('Nirolabel');
            expect(footer).not.toContain('Budget 2026');
            expect(html).not.toContain('budget-report-brand');
            expect(html).not.toContain('budget-report-eyebrow');
            if (showBranding && showDate) {
                expect(footer.indexOf('<img')).toBeLessThan(
                    footer.indexOf('Elaborato il'),
                );
            }
            if (!showBranding && !showDate) expect(footer).toBe('');
        },
    );
    it('captures all sorted filtered leaves, including collapsed groups, without controls or pagination', () => {
        const report = captureBudgetReport(table(), summary, ['Tutte']);
        expect(report.budget.entries.map((entry) => entry.id)).toEqual([
            1, 2, 3,
        ]);
        expect(report.budget.totals).toBe(totals);
        expect(
            captureBudgetReport(
                table('', false),
                summary,
                [],
            ).budget.entries.map((entry) => entry.id),
        ).toEqual([3, 2, 1]);
        expect(
            captureBudgetReport(
                table('Voce 2'),
                summary,
                [],
            ).budget.entries.map((entry) => entry.id),
        ).toEqual([2]);
        expect(
            captureBudgetReport(table('absent'), summary, []).budget.entries,
        ).toEqual([]);
        expect(() =>
            captureBudgetReport(table(), { ...summary, entries: [] }, []),
        ).toThrow('Dati del Budget cambiati');
    });
    it('renders server amounts, zero/missing, present rows, column order and optional sections safely', () => {
        const data = captureBudgetReport(table(), summary, ['Voci del Budget']);
        const html = renderToStaticMarkup(
            <BudgetReport
                data={data}
                options={{
                    ...defaultBudgetReportOptions('Tenant'),
                    blocks: ['kpis', 'table', 'totals'],
                    title: 'Budget <2026>',
                    orientation: 'portrait',
                    columns: ['allocated', 'description', 'actual', 'variance'],
                }}
                tenantName="Tenant"
                year={2026}
                createdAt="17/10/2026"
            />,
        );
        expect(html).toContain('Budget &lt;2026&gt;');
        expect(html).not.toContain('<script>');
        expect(html).toContain('0,00');
        expect(html).toContain('Da inserire');
        expect(html).not.toContain('Dati incompleti: scostamento provvisorio.');
        expect(html).not.toContain('Esclusa');
        expect(html).toContain('Solo stima');
        expect(html).not.toContain('Ripartizione del Budget');
        expect(html).not.toContain('<button');
        expect(html).not.toContain('Fornitore');
        expect(html.indexOf('data-column="allocated"')).toBeLessThan(
            html.indexOf('data-column="description"'),
        );
    });
    it('renders the empty set explicitly instead of the entire annual budget', () => {
        const html = renderToStaticMarkup(
            <BudgetReport
                data={captureBudgetReport(table('absent'), summary, [
                    'Ricerca: absent',
                ])}
                options={{
                    ...defaultBudgetReportOptions('Tenant'),
                    blocks: ['table'],
                    title: 'Vuoto',
                    orientation: 'landscape',
                    columns: ['description'],
                }}
                tenantName="Tenant"
                year={2027}
                createdAt="17/10/2026"
            />,
        );
        expect(html).toContain('Nessuna voce corrisponde');
        expect(html).not.toContain('data-entry-id');
        expect(html).not.toContain('Riepilogo economico');
        expect(html).toContain('2027');
    });
});

it('defaults to all blocks and columns except Status, supports independent scope, headings, totals and grouping', () => {
    const options = defaultBudgetReportOptions('Azienda');
    expect(options.hiddenBlocks).toEqual([]);
    expect(options.columns).not.toContain('status');
    const html = renderToStaticMarkup(
        <BudgetReport
            data={{ budget: summary, filters: ['Filtro segreto'] }}
            tenantName="Tenant"
            year={2027}
            createdAt="DATA"
            logoUrl="/logo.png"
            options={{
                ...options,
                title: 'Personalizzato',
                company: 'Azienda modificata',
                showScope: false,
                showYear: false,
                showDate: false,
                showLogo: false,
                blocks: ['table', 'kpis', 'totals'],
                hiddenBlocks: ['totals'],
                titles: {
                    ...options.titles,
                    table: 'Dettaglio personalizzato',
                },
            }}
        />,
    );
    expect(html).toContain('Azienda modificata');
    expect(html).toContain('Dettaglio personalizzato');
    expect(html).not.toContain('Filtro segreto');
    expect(html).not.toContain('righe nel report');
    expect(html).not.toContain('2027');
    expect(html).not.toContain('/logo.png');
    expect(html).not.toContain('DATA');
    expect(html).not.toContain('data-column="status"');
    expect(html).not.toContain('Totale delle voci incluse nel report');
    expect(html).toContain('Subtotale · Spese singole');
    expect(html.indexOf('data-report-block="table"')).toBeLessThan(
        html.indexOf('data-report-block="kpis"'),
    );
});
it('uses server vendor groups and all attributed source amounts for charts', () => {
    const vendorTotals = {
        ...totals,
        name: 'Fornitore delle spese',
        allocated: '10.10',
        actual: '1.00',
        variance: '-9.10',
        count: 2,
    };
    const snapshot = {
        ...summary,
        vendor_groups: { '8': vendorTotals },
        entries: [
            {
                ...entries[0],
                vendor: { id: 9, name: 'Fornitore del contenitore' },
            },
            {
                ...entries[1],
                type: 'project' as const,
                allocated: '0.00',
                actual: null,
            },
            {
                ...entries[2],
                type: 'project' as const,
                actual: '900.00',
            },
        ],
    };
    expect(budgetReportGroups(snapshot, 'vendors')).toEqual([
        { ...vendorTotals, id: '8' },
    ]);
    expect(budgetReportGroups(snapshot, 'projects')).toHaveLength(2);
    expect(budgetReportGroups(snapshot, 'projects')[0]).toMatchObject({
        id: entries[1].id,
        allocated: '0.00',
        actual: null,
    });
});
it('groups the table by type using server subtotals, or keeps the original order when disabled', () => {
    const mixed = {
        ...summary,
        entries: [
            { ...entries[0], type: 'project' as const },
            { ...entries[1], type: 'contract' as const },
            entries[2],
        ],
        groups: {
            ...summary.groups,
            contract: { ...totals, allocated: '123.45' },
        },
    };
    const options = {
        ...defaultBudgetReportOptions('Tenant'),
        blocks: ['table'] as const,
    };
    const render = (groupByType: boolean, subtotals: boolean) =>
        renderToStaticMarkup(
            <BudgetReport
                tenantName="Tenant"
                year={2027}
                createdAt="date"
                data={{ budget: mixed, filters: [] }}
                options={{
                    ...options,
                    blocks: ['table'],
                    groupByType,
                    subtotals,
                }}
            />,
        );
    const grouped = render(true, true);
    expect(grouped.indexOf('data-entry-id="2"')).toBeLessThan(
        grouped.indexOf('data-entry-id="3"'),
    );
    expect(grouped).toContain('123,45');
    expect(render(true, false)).not.toContain('Subtotale');
    const ungrouped = render(false, true);
    expect(ungrouped.indexOf('data-entry-id="3"')).toBeLessThan(
        ungrouped.indexOf('data-entry-id="2"'),
    );
    expect(ungrouped).not.toContain('Subtotale');
});

it('keeps the overview selection of five overruns and five savings, omitting zero and missing rows', () => {
    const rows: BudgetEntry[] = Array.from({ length: 20 }, (_, index) => ({
        ...entries[0],
        id: index,
        variance: String(index - 10),
    }));
    rows.push({ ...entries[0], id: 31, variance: null });
    const selected = budgetReportVariances({ ...summary, entries: rows });
    expect(selected.map((row) => row.id)).toEqual([
        19, 18, 17, 16, 15, 0, 1, 2, 3, 4,
    ]);
});

it('defaults to portrait, removes obsolete charts and places the processing date only in the footer', () => {
    const options = defaultBudgetReportOptions('Azienda');
    expect(options.orientation).toBe('portrait');
    expect(options.blocks).not.toContain('completeness');
    expect(options.blocks).not.toContain('vendors');
    expect(options.titles.distribution).toBe('Distribuzione Fornitore');
    const html = renderToStaticMarkup(
        <BudgetReport
            data={{ budget: summary, filters: [] }}
            options={{
                ...options,
                blocks: ['sankey', 'reconciliation'],
                sankeyMetric: 'actual',
                reconciliationMetric: 'allocated',
            }}
            tenantName="Azienda"
            year={2027}
            createdAt="17/10/2026, 12:00:00"
        />,
    );
    expect(html.indexOf('17/10/2026, 12:00:00')).toBeGreaterThan(
        html.indexOf('<footer'),
    );
    const sankey = html.slice(
        html.indexOf('data-report-block="sankey"'),
        html.indexOf('data-report-block="reconciliation"'),
    );
    expect(sankey).toContain('Effettivo');
    expect(sankey).not.toContain('Allocato');
    expect(html).toContain('Allocato netto');
    expect(html).not.toContain('Effettivo netto');
});
it('keeps known allocated amounts in the supplier bar chart when all actuals are missing, and distinguishes zero', () => {
    const budget = {
        ...summary,
        vendor_groups: {
            none: {
                ...totals,
                name: 'Senza fornitore',
                allocated: '63296.44',
                actual: null,
            },
        },
    };
    const html = renderToStaticMarkup(
        <BudgetReport
            data={{ budget, filters: [] }}
            options={{
                ...defaultBudgetReportOptions('Azienda'),
                blocks: ['distribution'],
            }}
            tenantName="Azienda"
            year={2027}
            createdAt="DATA"
        />,
    );
    expect(html).toContain('63.296,44');
    expect(html).toContain('Da inserire');
    expect(html).not.toContain('Percentuale');
    const zero = renderToStaticMarkup(
        <BudgetReport
            data={{
                budget: {
                    ...budget,
                    vendor_groups: {
                        none: {
                            ...totals,
                            name: 'Senza fornitore',
                            allocated: '63296.44',
                            actual: '0.00',
                        },
                    },
                },
                filters: [],
            }}
            options={{
                ...defaultBudgetReportOptions('Azienda'),
                blocks: ['distribution'],
            }}
            tenantName="Azienda"
            year={2027}
            createdAt="DATA"
        />,
    );
    expect(zero).not.toContain('Da inserire</td>');
    expect(zero).toContain('0,00');
});

it.each([
    ['-19.99', '-19,99'],
    ['19.99', '19,99'],
    ['0.00', '0,00'],
])(
    'prints variance %s without a positive or zero sign',
    (variance, formatted) => {
        const html = renderToStaticMarkup(
            <BudgetReport
                data={{
                    budget: {
                        ...summary,
                        totals: { ...totals, variance },
                        entries: [{ ...entries[0], variance }],
                    },
                    filters: [],
                }}
                options={{
                    ...defaultBudgetReportOptions('Tenant'),
                    blocks: ['kpis', 'table'],
                    groupByType: false,
                    columns: ['variance'],
                    showScope: false,
                }}
                tenantName="Tenant"
                year={2026}
                createdAt="DATA"
            />,
        );
        expect(html).toContain(formatted);
        expect(html).not.toContain(`+${formatted}`);
        if (variance === '0.00') expect(html).not.toContain('-0,00');
        expect(html).not.toContain('Dati incompleti: scostamento provvisorio.');
    },
);
