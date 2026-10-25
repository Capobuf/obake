import { describe, expect, it } from 'vite-plus/test';
import {
    budgetFiltersUrl,
    readBudgetFilters,
} from '../../resources/js/components/management/budget-filters';

const path = '/t/alfa/budget?year=2026';
const vendors = [{ id: 7, name: 'Fornitore' }];
const centers = [{ id: 9, name: 'Centro' }];
const defaults = {
    search: '',
    type: 'all',
    vendor_id: 'all',
    cost_center_id: 'all',
};

describe('Budget query filters', () => {
    it('restores all four filters from a shareable URL, keeping year and hash', () => {
        const filters = {
            search: 'Canone + assistenza & café',
            type: 'contract',
            vendor_id: '7',
            cost_center_id: '9',
        };
        const url = budgetFiltersUrl(`${path}#voci`, filters, 2026);
        expect(readBudgetFilters(url, vendors, centers)).toEqual(filters);
        expect(url).toContain('year=2026');
        expect(url).toContain('#voci');
    });

    it('uses defaults for invalid types, foreign suppliers and foreign centers', () => {
        const url = `${path}&type=unknown&vendor_id=88&cost_center_id=99`;
        const filters = readBudgetFilters(url, vendors, centers);
        expect(filters).toEqual(defaults);
        expect(budgetFiltersUrl(url, filters, 2026)).toBe(path);
    });

    it('validates the supplier against the current budget year and tenant', () => {
        const url = `${path}&vendor_id=7&cost_center_id=9&type=project`;
        expect(readBudgetFilters(url, vendors, centers).vendor_id).toBe('7');
        expect(readBudgetFilters(url, [], centers).vendor_id).toBe('all');
        expect(readBudgetFilters(url, [], []).cost_center_id).toBe('all');
        expect(readBudgetFilters(url, [], []).type).toBe('project');
        expect(
            readBudgetFilters(
                url.replace('/t/alfa/', '/t/beta/'),
                [{ id: 70, name: 'Altro fornitore' }],
                [{ id: 90, name: 'Altro centro' }],
            ),
        ).toEqual({ ...defaults, type: 'project' });
    });

    it('keeps the filters for unassigned suppliers and centers', () => {
        expect(
            readBudgetFilters(
                `${path}&vendor_id=none&cost_center_id=none`,
                [],
                [],
            ),
        ).toEqual({ ...defaults, vendor_id: 'none', cost_center_id: 'none' });
    });

    it('clears filter parameters while preserving unrelated query parameters', () => {
        expect(
            budgetFiltersUrl(
                `${path}&search=test&type=expense&vendor_id=7&cost_center_id=9&other=value`,
                defaults,
                2026,
            ),
        ).toBe(`${path}&other=value`);
        expect(readBudgetFilters(path, vendors, centers)).toEqual(defaults);
    });

    it('includes the selected year when the page used the session default', () => {
        expect(
            budgetFiltersUrl(
                '/t/alfa/budget?search=Canone',
                { ...defaults, search: 'Canone' },
                2027,
            ),
        ).toBe('/t/alfa/budget?search=Canone&year=2027');
    });

    it.each(['undefined', 'null', '7oops', '-7', '7.0', '007'])(
        'ignores malformed relation ID %s',
        (id) => {
            expect(
                readBudgetFilters(
                    `${path}&vendor_id=${id}&cost_center_id=${id}`,
                    vendors,
                    centers,
                ),
            ).toEqual(defaults);
        },
    );
});
