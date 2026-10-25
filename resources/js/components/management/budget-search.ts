import { budgetLabels, type BudgetEntry } from './budget-types';
import type { Expense } from './types';

export function searchAmount(search: string): string | null {
    let value = search.trim();
    if (/^-?\d{1,3}(?:\.\d{3})+,\d{1,2}$/.test(value))
        value = value.replaceAll('.', '');
    value = value.replace(',', '.');
    if (!/^-?\d{1,14}(?:\.\d{1,2})?$/.test(value)) return null;
    const [whole, fraction = ''] = value.replace('-', '').split('.');
    const amount = `${whole.replace(/^0+(?=\d)/, '')}.${fraction.padEnd(2, '0')}`;
    return value.startsWith('-') && amount !== '0.00' ? `-${amount}` : amount;
}

function matches(
    search: string,
    texts: (string | null | undefined)[],
    amounts: (string | null | undefined)[],
) {
    const text = search.trim().toLocaleLowerCase('it');
    if (!text) return true;
    const amount = searchAmount(text);
    return (
        texts.some((value) => value?.toLocaleLowerCase('it').includes(text)) ||
        (amount !== null &&
            amounts.some(
                (value) => value != null && searchAmount(value) === amount,
            ))
    );
}

function budgetParentMatches(entry: BudgetEntry, search: string) {
    return matches(
        search,
        [
            entry.description,
            entry.notes,
            entry.vendor?.name,
            entry.cost_center?.name,
            budgetLabels[entry.type],
        ],
        [entry.allocated, entry.actual, entry.variance],
    );
}

function budgetExpenseMatches(expense: Expense, search: string) {
    return matches(
        search,
        [
            expense.title,
            expense.notes,
            expense.vendor?.name,
            expense.contract?.name,
            expense.project?.name,
            ...(expense.cost_centers ?? []).flatMap((center) => [
                center.name,
                center.parent?.name,
            ]),
            ...(expense.lines ?? []).map((line) => line.description),
        ],
        [
            expense.allocated_amount,
            expense.actual_amount,
            expense.allocated_amount != null || expense.actual_amount != null
                ? expense.variance
                : null,
            ...(expense.lines ?? []).flatMap((line) => [
                line.unit_price,
                line.total,
            ]),
        ],
    );
}

export function budgetSearchMatch(entry: BudgetEntry, search: string) {
    const parent = budgetParentMatches(entry, search);
    const child =
        !!search.trim() &&
        entry.expenses.some((expense) => budgetExpenseMatches(expense, search));
    return { matches: parent || child, expand: !parent && child };
}
