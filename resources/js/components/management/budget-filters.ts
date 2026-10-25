import { budgetTypes } from './budget-types';
import type { Option } from './types';

export type BudgetFilters = {
    search: string;
    type: string;
    vendor_id: string;
    cost_center_id: string;
};

export function readBudgetFilters(
    url: string,
    vendors: Option[],
    centers: Option[],
): BudgetFilters {
    const params = new URL(url, 'http://localhost').searchParams;
    const type = params.get('type');
    const vendor = params.get('vendor_id');
    const center = params.get('cost_center_id');
    return {
        search: params.get('search') ?? '',
        type:
            type && budgetTypes.some((value) => value === type) ? type : 'all',
        vendor_id:
            vendor &&
            (vendor === 'none' ||
                vendors.some((item) => String(item.id) === vendor))
                ? vendor
                : 'all',
        cost_center_id:
            center &&
            (center === 'none' ||
                centers.some((item) => String(item.id) === center))
                ? center
                : 'all',
    };
}

export function budgetFiltersUrl(
    url: string,
    filters: BudgetFilters,
    year: number,
): string {
    const next = new URL(url, 'http://localhost');
    next.searchParams.set('year', String(year));
    for (const [key, value] of Object.entries(filters)) {
        if (value === '' || (key !== 'search' && value === 'all'))
            next.searchParams.delete(key);
        else next.searchParams.set(key, value);
    }
    return `${next.pathname}${next.search}${next.hash}`;
}
