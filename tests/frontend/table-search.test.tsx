import { describe, expect, it } from 'vite-plus/test';
import { renderToStaticMarkup } from 'react-dom/server';
import {
    budgetSearchMatch,
    searchAmount,
} from '../../resources/js/components/management/budget-search';
import { TableSearchInput } from '../../resources/js/components/management/table-search-input';
import type { BudgetEntry } from '../../resources/js/components/management/budget-types';

const entry: BudgetEntry = {
    id: 1,
    type: 'contract',
    source_id: 1,
    description: 'Infrastruttura',
    position: 0,
    cost_center_id: null,
    cost_center: null,
    vendor: { id: 1, name: 'Acme' },
    notes: 'Rinnovo',
    starts_on: null,
    ends_on: null,
    allocated: '2000.00',
    actual: '1750.00',
    variance: '-250.00',
    estimated_count: 0,
    comparable_count: 1,
    allocated_positive: '2000.00',
    allocated_negative: '0.00',
    actual_positive: '1750.00',
    actual_negative: '0.00',
    expenses: [
        {
            id: 9,
            title: 'Server Dell',
            year: 2026,
            notes: 'Garanzia estesa',
            vendor: { id: 2, name: 'Partner diverso' },
            allocated_amount: '1250.50',
            actual_amount: '1200.25',
            variance: '-50.25',
            lines: [
                {
                    description: 'Licenza speciale',
                    type: 'allocated',
                    unit_price: '625.25',
                    total: '1250.50',
                    quantity: '2',
                },
            ],
            contributes: false,
            counted_in: 'Altro padre',
        },
    ],
};

describe('table search', () => {
    it.each(['1250,50', '1.250,50', '1250.50', ' 001250,5 '])(
        'normalizes %s without floating point',
        (value) => {
            expect(searchAmount(value)).toBe('1250.50');
        },
    );
    it.each(['', 'null', '1e3', '12abc', '1.25,50', '1,250.50', '1.2505'])(
        'does not turn %s into an amount',
        (value) => {
            expect(searchAmount(value)).toBeNull();
        },
    );
    it('keeps zero, negatives, and high precision exact', () => {
        expect(searchAmount('0')).toBe('0.00');
        expect(searchAmount('-0,00')).toBe('0.00');
        expect(searchAmount('-1.250,50')).toBe('-1250.50');
        expect(searchAmount('99999999999999,99')).toBe('99999999999999.99');
        expect(searchAmount('1250,51')).not.toBe(searchAmount('1250,50'));
    });
    it.each([
        ' SERVER dell ',
        'Garanzia',
        'Partner diverso',
        'Licenza speciale',
        '1.250,50',
        '625,25',
        '-50,25',
    ])('finds %s in children and temporarily opens the parent', (search) => {
        expect(budgetSearchMatch(entry, search)).toEqual({
            matches: true,
            expand: true,
        });
    });
    it.each(['Infrastruttura', 'Rinnovo', 'Acme', 'Contratti', '2000', '-250'])(
        'does not force open a parent match for %s',
        (search) => {
            expect(budgetSearchMatch(entry, search)).toEqual({
                matches: true,
                expand: false,
            });
        },
    );
    it('restores manual expansion when cleared and does not treat null as zero', () => {
        expect(budgetSearchMatch(entry, '')).toEqual({
            matches: true,
            expand: false,
        });
        expect(
            budgetSearchMatch(
                {
                    ...entry,
                    allocated: null,
                    actual: null,
                    variance: null,
                    expenses: [],
                },
                '0',
            ),
        ).toEqual({ matches: false, expand: false });
        expect(budgetSearchMatch({ ...entry, allocated: '0.00' }, '0')).toEqual(
            { matches: true, expand: false },
        );
        expect(budgetSearchMatch(entry, '1250,51').matches).toBe(false);
    });
    it('renders an accessible shared input and a text-only clear control', () => {
        const html = renderToStaticMarkup(
            <TableSearchInput value="Dell" onChange={() => {}} />,
        );
        expect(html).toContain('placeholder="Cerca in questa tabella…"');
        expect(html).toContain('aria-label="Cerca in questa tabella"');
        expect(html).toContain('aria-label="Cancella ricerca"');
        expect(html).toContain('type="button"');
        expect(html).not.toContain('type="submit"');
    });
    it('starts with an accessible search icon when the text is empty', () => {
        const html = renderToStaticMarkup(
            <TableSearchInput value="" onChange={() => {}} />,
        );
        expect(html).toContain('aria-expanded="false"');
        expect(html).toContain('aria-label="Cerca in questa tabella"');
        expect(html).toContain('motion-reduce:transition-none');
        expect(html).not.toContain('<input');
    });
});
