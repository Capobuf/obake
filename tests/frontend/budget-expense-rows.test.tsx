import { describe, expect, it, vi } from 'vite-plus/test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ComponentProps } from 'react';
import { ExpenseRows } from '../../resources/js/components/management/budget-table';
import { TooltipProvider } from '../../resources/js/components/ui/tooltip';
import type { BudgetEntry } from '../../resources/js/components/management/budget-types';
import {
    money,
    varianceTextClass,
} from '../../resources/js/components/management/helpers';

vi.mock('@inertiajs/react', () => ({
    Link: (props: ComponentProps<'a'>) => <a {...props} />,
    usePage: () => ({ props: { economicContext: { year: 2026 } } }),
}));

const expense: BudgetEntry['expenses'][number] = {
    id: 11,
    title: 'Canone annuale',
    year: 2026,
    vendor: { id: 21, name: 'Fornitore della spesa' },
    cost_centers: [
        {
            id: 31,
            name: 'Software',
            parent_id: 30,
            parent: { id: 30, name: 'IT' },
        },
        { id: 32, name: 'Ricerca', parent_id: null },
    ],
    allocated_amount: '100.00',
    actual_amount: '80.00',
    variance: '-20.00',
    contributes: true,
    counted_in: null,
};
const entry: BudgetEntry = {
    id: 1,
    type: 'contract',
    source_id: 1,
    description: 'Contratto',
    position: 0,
    vendor: { id: 99, name: 'Fornitore del contratto' },
    cost_center_id: 98,
    cost_center: { id: 98, name: 'Centro Budget' },
    allocated: '100.00',
    actual: '80.00',
    variance: '-20.00',
    estimated_count: 0,
    comparable_count: 1,
    allocated_positive: '100.00',
    allocated_negative: '0.00',
    actual_positive: '80.00',
    actual_negative: '0.00',
    notes: null,
    starts_on: null,
    ends_on: null,
    expenses: [expense],
};
const columns = [
    'expand',
    'description',
    'type',
    'vendor',
    'center',
    'allocated',
    'actual',
    'variance',
    'actions',
];

function render(source = entry, columnIds = columns) {
    return renderToStaticMarkup(
        <TooltipProvider>
            <table>
                <tbody>
                    <ExpenseRows
                        entry={source}
                        columnIds={columnIds}
                        slug="alfa"
                        busy={false}
                        highlightEstimate={false}
                        onExpenseEdit={vi.fn()}
                        onRecordSave={vi.fn()}
                    />
                </tbody>
            </table>
        </TooltipProvider>,
    );
}

function cells(html: string) {
    return [...html.matchAll(/<td\b[^>]*>(.*?)<\/td>/gs)].map(
        (match) => match[1],
    );
}

describe('Budget expense subrows', () => {
    it.each(['contract', 'project'] as const)(
        'shows each expense supplier and centers under a %s without changing totals',
        (type) => {
            const source = {
                ...entry,
                type,
                vendor: type === 'project' ? null : entry.vendor,
                expenses: [
                    expense,
                    {
                        ...expense,
                        id: 12,
                        vendor: { id: 22, name: 'Secondo fornitore' },
                    },
                ],
            };
            const before = structuredClone(source);
            const html = render(source);
            const rows = cells(html);
            expect(rows).toHaveLength(columns.length * 2);
            expect(rows[3]).toContain('href="/t/alfa/vendors/21"');
            expect(rows[3]).toContain('Fornitore della spesa');
            expect(rows[columns.length + 3]).toContain('Secondo fornitore');
            expect(rows[4]).toContain('IT / Software');
            expect(rows[4]).toContain('Ricerca');
            expect(rows[2]).toContain('>Spesa<');
            expect(html).not.toContain('Fornitore del contratto');
            expect(html).not.toContain('Centro Budget');
            expect(rows[1]).toContain('href="/t/alfa/expenses/11"');
            expect(rows[1]).toContain('aria-label="Apri Canone annuale"');
            expect(rows[1]).toContain('lucide-arrow-up-right');
            expect(html).not.toContain('Apri spesa');
            expect(rows[5]).toContain(money('100.00'));
            expect(rows[6]).toContain(money('80.00'));
            expect(rows[8]).toContain('Azioni per la spesa Canone annuale');
            expect(source).toEqual(before);
        },
    );

    it('preserves column order and visibility with missing relations', () => {
        const source = {
            ...entry,
            expenses: [{ ...expense, vendor: null, cost_centers: [] }],
        };
        const rows = cells(
            render(source, ['variance', 'center', 'vendor', 'type']),
        );
        expect(rows).toHaveLength(4);
        expect(rows[0]).toContain(money('-20.00'));
        expect(rows[1]).toBe('Senza centro di costo');
        expect(rows[2]).toBe('Senza fornitore');
        expect(rows[3]).toContain('>Spesa<');
        const hidden = render(entry, ['description', 'actual']);
        expect(cells(hidden)).toHaveLength(2);
        expect(hidden).not.toContain('Fornitore della spesa');
        expect(hidden).not.toContain('IT / Software');
        expect(hidden).not.toContain(money('-20.00'));
    });

    it.each([
        ['100.00', '80.00', '-20.00'],
        ['100.00', '120.00', '20.00'],
        ['100.00', null, '-100.00'],
        [null, '80.00', '80.00'],
        [null, null, '0.00'],
        ['0.00', '0.00', '0.00'],
        [null, null, null],
    ])(
        'renders annual variance and colors for %s / %s',
        (allocated, actual, variance) => {
            const html = render(
                {
                    ...entry,
                    expenses: [
                        {
                            ...expense,
                            allocated_amount: allocated,
                            actual_amount: actual,
                            variance,
                        },
                    ],
                },
                ['variance'],
            );
            expect(html).toContain(
                variance === null ? 'Non confrontabile' : money(variance),
            );
            expect(html).toContain(varianceTextClass(variance));
            expect(html).toContain('text-right');
        },
    );

    it.each([
        columns,
        ['description', 'vendor', 'actual'],
        ['vendor', 'center', 'description', 'actual'],
    ])(
        'aligns economic lines to the description column and keeps attribution (%j)',
        (...visibleColumns) => {
            const source = {
                ...entry,
                expenses: [
                    {
                        ...expense,
                        contributes: false,
                        counted_in: 'Altro contratto',
                        lines: [
                            {
                                id: 1,
                                description: 'Licenza',
                                type: 'actual' as const,
                                quantity: '1',
                                unit_price: '80.00',
                                year: 2026,
                            },
                        ],
                    },
                ],
            };
            const html = render(source, visibleColumns);
            expect(html).toContain('Conteggiata in: Altro contratto');
            expect(html).not.toContain('Righe economiche di');
            expect(html).toContain('id="budget-expense-lines-1:11"');
            const descriptionIndex = visibleColumns.indexOf('description');
            expect(html).toContain(
                `colSpan="${visibleColumns.length - descriptionIndex}"`,
            );
            if (descriptionIndex > 0) {
                expect(html).toMatch(
                    new RegExp(
                        `<td[^>]*colSpan="${descriptionIndex}"[^>]*></td>`,
                    ),
                );
            } else {
                expect(html).not.toContain('colSpan="0"');
            }
            expect(html).toContain('Licenza');
            expect(html).not.toContain('Filtri');
        },
    );

    it('opens all linked expenses and keeps missing-amount actions without repeating totals', () => {
        const source = {
            ...entry,
            estimated_count: 1,
            expenses: [
                {
                    ...expense,
                    actual_amount: null,
                    variance: '-100.00',
                    lines: [
                        {
                            id: 1,
                            description: 'Licenza prevista',
                            type: 'allocated' as const,
                            quantity: '1',
                            unit_price: '100.00',
                            year: 2026,
                        },
                    ],
                },
                {
                    ...expense,
                    id: 12,
                    title: 'Assistenza',
                    vendor: { id: 22, name: 'Fornitore assistenza' },
                    lines: [
                        {
                            id: 2,
                            description: 'Intervento effettuato',
                            type: 'actual' as const,
                            quantity: '1',
                            unit_price: '80.00',
                            year: 2026,
                        },
                    ],
                },
            ],
        };
        const html = render(source);
        expect(html).toContain('id="budget-expense-lines-1:11"');
        expect(html).toContain('id="budget-expense-lines-1:12"');
        expect(html).toContain('Licenza prevista');
        expect(html).toContain('Intervento effettuato');
        expect(html).toContain('Fornitore assistenza');
        expect(html).toContain('href="/t/alfa/expenses/12"');
        expect(html).toContain('Solo stima');
        expect(cells(html).slice(5, 8)).toEqual(['', '', '']);
        expect(html).not.toContain('Righe economiche di');
        expect(html).not.toContain('Filtri');
    });
});
