import { beforeEach, expect, it, vi } from 'vite-plus/test';
import { renderToStaticMarkup } from 'react-dom/server';
import { useState, type ComponentProps } from 'react';
import { toast } from 'sonner';
import {
    api,
    ApiError,
} from '../../resources/js/components/management/helpers';
import {
    InlineEdit,
    saveInlineRecord,
} from '../../resources/js/components/management/inline-edit';
import { BudgetReassignmentRequired } from '../../resources/js/components/management/budget-reassignment';
import { BudgetLinkPreview } from '../../resources/js/components/management/budget-link-preview';
import type { BudgetReassignmentPreview } from '../../resources/js/components/management/budget-link-preview';

const mocks = vi.hoisted(() => ({
    detailsOpen: false,
    keyDown: vi.fn(),
    reload: vi.fn(),
    setters: [] as ReturnType<typeof vi.fn>[],
}));
vi.mock('@inertiajs/react', () => ({ router: { reload: mocks.reload } }));
vi.mock('sonner', () => ({
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));
vi.mock(
    '../../resources/js/components/management/helpers',
    async (original) => ({
        ...(await original<
            typeof import('../../resources/js/components/management/helpers')
        >()),
        api: vi.fn(),
    }),
);
vi.mock('react', async (original) => {
    const react = await original<typeof import('react')>();
    return { ...react, useState: vi.fn(react.useState) };
});
vi.mock('../../resources/js/components/ui/input', () => ({
    Input: (props: { onKeyDown: typeof mocks.keyDown }) => {
        mocks.keyDown = props.onKeyDown;
        return <input />;
    },
}));

vi.mock('../../resources/js/components/ui/collapsible', async (original) => {
    const components =
        await original<
            typeof import('../../resources/js/components/ui/collapsible')
        >();
    return {
        ...components,
        Collapsible: (props: ComponentProps<typeof components.Collapsible>) => (
            <components.Collapsible
                {...props}
                defaultOpen={mocks.detailsOpen}
            />
        ),
    };
});

beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('requestAnimationFrame', vi.fn());
    mocks.setters = [];
    mocks.detailsOpen = false;
});

it('identifies only the structured conflict and retains the exact unsaved request', async () => {
    const data = { project_id: 5, title: 'Bozza', notes: 'Non perdere' };
    vi.mocked(api).mockRejectedValue(
        new ApiError(
            'Messaggio indipendente',
            {},
            'budget_reassignment_required',
        ),
    );
    await expect(
        saveInlineRecord('/t/alfa/expenses/4', data),
    ).rejects.toMatchObject({
        url: '/t/alfa/expenses/4',
        data,
    });
    expect(mocks.reload).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
    expect(toast.warning).not.toHaveBeenCalled();
    const ordinary = new ApiError('Questa spesa è già nel Budget.', {
        vendor_id: ['Non valido'],
    });
    vi.mocked(api).mockRejectedValue(ordinary);
    await expect(saveInlineRecord('/t/alfa/expenses/4', data)).rejects.toBe(
        ordinary,
    );
});

it('opens the inline dialog without setting a transient field error', async () => {
    const conflict = new BudgetReassignmentRequired('/t/alfa/expenses/4', {
        project_id: 5,
    });
    for (const value of [true, '5', false, '', null]) {
        const setter = vi.fn();
        mocks.setters.push(setter);
        vi.mocked(useState).mockImplementationOnce(() => [value, setter]);
    }
    const save = vi.fn().mockRejectedValue(conflict);
    renderToStaticMarkup(
        <InlineEdit value="" label="Progetto" onSave={save} />,
    );
    mocks.keyDown({ key: 'Enter', preventDefault: vi.fn() });
    await vi.waitFor(() =>
        expect(mocks.setters[4]).toHaveBeenCalledWith(conflict),
    );
    expect(mocks.setters[0]).toHaveBeenCalledWith(false);
    expect(mocks.setters[3].mock.calls).toEqual([['']]);
    expect(toast.error).not.toHaveBeenCalled();
});

it.each([
    [new Error('Rete non disponibile'), true],
    [
        new ApiError('Importo non valido', {
            actual_amount: ['Importo non valido'],
        }),
        false,
    ],
])(
    'keeps the inline draft and uses one error channel for %s',
    async (failure, transient) => {
        for (const value of [true, 'bozza', false, '', null]) {
            const setter = vi.fn();
            mocks.setters.push(setter);
            vi.mocked(useState).mockImplementationOnce(() => [value, setter]);
        }
        const save = vi.fn().mockRejectedValue(failure);
        renderToStaticMarkup(
            <InlineEdit value="originale" label="Importo" onSave={save} />,
        );
        mocks.keyDown({ key: 'Enter', preventDefault: vi.fn() });
        await vi.waitFor(() =>
            expect(mocks.setters[3]).toHaveBeenCalledWith(failure.message),
        );
        expect(save).toHaveBeenCalledExactlyOnceWith('bozza');
        expect(mocks.setters[0]).not.toHaveBeenCalled();
        expect(mocks.setters[1]).not.toHaveBeenCalled();
        expect(mocks.setters[2]).toHaveBeenLastCalledWith(false);
        expect(requestAnimationFrame).toHaveBeenCalledOnce();
        if (transient)
            expect(toast.error).toHaveBeenCalledExactlyOnceWith(
                failure.message,
            );
        else expect(toast.error).not.toHaveBeenCalled();
    },
);

it('keeps inline error details out of the cell layout and reachable by keyboard', () => {
    for (const value of [true, 'bozza', false, 'Importo non valido', null]) {
        vi.mocked(useState).mockImplementationOnce(() => [value, vi.fn()]);
    }
    const html = renderToStaticMarkup(
        <InlineEdit value="originale" label="Importo" onSave={vi.fn()} />,
    );
    expect(html).toContain('data-invalid="true"');
    expect(html).toContain('aria-describedby=');
    expect(html).toContain('aria-label="Errore: Importo"');
    expect(html).toContain('class="sr-only">Importo non valido</span>');
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('data-slot="field-error"');
});

it('saves ordinary automatic links without requesting a preview', async () => {
    vi.mocked(api).mockResolvedValue({ record: { id: 4, project_id: 5 } });
    mocks.reload.mockImplementationOnce(({ onSuccess }) => onSuccess());
    await saveInlineRecord('/t/alfa/expenses/4', { project_id: 5 });
    expect(api).toHaveBeenCalledExactlyOnceWith('/t/alfa/expenses/4', 'PATCH', {
        project_id: 5,
    });
    expect(mocks.reload).toHaveBeenCalledOnce();
    expect(toast.error).not.toHaveBeenCalled();
});

const preview: BudgetReassignmentPreview = {
    expense: { id: 4, title: 'Servizio' },
    target: { id: 5, type: 'project', name: 'Nuova sede', year: 2026 },
    valid: true,
    problem: null,
    automatic: false,
    token: 'token',
    choices: {
        add: { valid: true, problem: null },
        link: { valid: true, problem: null },
    },
    years: [
        {
            year: 2026,
            budget_id: 1,
            direct_entries: [{ id: 1 }],
            destination: 'missing',
            expense_before: {
                allocated: '100.00',
                actual: null,
                variance: '-100.00',
            },
            expense_after: {
                allocated: '100.00',
                actual: null,
                variance: '-100.00',
            },
            budget_before: {
                allocated: '100.00',
                actual: null,
                variance: '-100.00',
            },
            budget_after: {
                add: {
                    allocated: '600.00',
                    actual: null,
                    variance: '-600.00',
                    count: 1,
                },
                link: {
                    allocated: null,
                    actual: null,
                    variance: '0.00',
                    count: 0,
                },
            },
            difference: {
                add: { allocated: '500.00', actual: null, variance: '-500.00' },
                link: {
                    allocated: '-100.00',
                    actual: null,
                    variance: '100.00',
                },
            },
        },
    ],
};
function renderPreview(data = preview, busy = false) {
    return renderToStaticMarkup(
        <BudgetLinkPreview preview={data} onChoose={vi.fn()} busy={busy} />,
    );
}

it('shows both explicit choices and their server totals without unavailable metrics', () => {
    const html = renderPreview();
    expect(html).toContain('Collega e aggiungi al Budget');
    expect(html).toContain('Collega senza aggiungere');
    expect(html).toContain('anche le altre spese del progetto');
    expect(html).toContain('600,00');
    expect(html).toContain('+500,00');
    expect(html).toContain('-100,00');
    expect(html).toContain('Il Budget resterà senza voci.');
    expect(html).not.toContain('Effettivo');
    expect(html).not.toContain('—');
    expect(html).not.toContain('Esclus');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('Importi della spesa');
});

it('shows only the unchanged message when totals stay the same', () => {
    const year = preview.years[0];
    const after = { ...year.budget_before!, count: 1 };
    const html = renderPreview({
        ...preview,
        years: [{ ...year, budget_after: { add: after, link: after } }],
    });
    expect(html.match(/Il totale resta invariato./g)).toHaveLength(2);
    expect(html).not.toContain('<dl');
    expect(html).not.toContain('Variazione');
});

it('offers one confirmation when the destination is already in the Budget', () => {
    const year = preview.years[0];
    const html = renderPreview({
        ...preview,
        years: [
            {
                ...year,
                direct_entries: [],
                destination: 'present',
                budget_after: {
                    add: year.budget_after.add,
                    link: year.budget_after.add,
                },
                difference: {
                    add: year.difference.add,
                    link: year.difference.add,
                },
            },
        ],
    });
    expect(html).toContain('Conferma collegamento');
    expect(html).toContain('Progetto già nel Budget');
    expect(html).toContain('anche i suoi importi entrano nel Budget');
    expect(html).toContain('600,00');
    expect(html).toContain('+500,00');
    expect(html).not.toContain('Collega e aggiungi al Budget');
    expect(html).not.toContain('Collega senza aggiungere');
});

it.each(['contract', 'project'] as const)(
    'reuses the single choice for an included %s and ignores years without a Budget',
    (type) => {
        const year = preview.years[0];
        const html = renderPreview({
            ...preview,
            target: { ...preview.target, type },
            years: [
                { ...year, destination: 'present' },
                {
                    ...year,
                    year: 2027,
                    budget_id: null,
                    destination: 'missing',
                },
            ],
        });
        expect(html).toContain(
            type === 'contract'
                ? 'Contratto già nel Budget'
                : 'Progetto già nel Budget',
        );
        expect(html).toContain('Conferma collegamento');
        expect(html).not.toContain('Collega e aggiungi al Budget');
        expect(html).toContain('Nessun Budget per questo anno.');
        expect(api).not.toHaveBeenCalled();
    },
);

it.each(['present', 'missing'] as const)(
    'disables every action while saving with destination %s',
    (destination) => {
        const html = renderPreview(
            {
                ...preview,
                years: [{ ...preview.years[0], destination }],
            },
            true,
        );
        expect(html.match(/disabled=""/g)).toHaveLength(
            destination === 'present' ? 1 : 2,
        );
    },
);

it('keeps invalid single-choice previews blocked with their explanation', () => {
    const invalid = { valid: false, problem: 'Verifica gli anni.' };
    const html = renderPreview({
        ...preview,
        ...invalid,
        choices: { add: invalid, link: invalid },
        years: [{ ...preview.years[0], destination: 'present' }],
    });
    expect(html).toContain('Verifica gli anni.');
    expect(html.match(/disabled=""/g)).toHaveLength(1);
    expect(html).not.toContain('<dl');
    expect(html).not.toContain('Dettagli economici');
});

it('disables only the unavailable choice with its explanation', () => {
    const html = renderPreview({
        ...preview,
        choices: {
            ...preview.choices,
            add: { valid: false, problem: 'Anno incompatibile.' },
        },
    });
    expect(html).toContain('Anno incompatibile.');
    expect(html.match(/disabled=""/g)).toHaveLength(1);
    expect(html).not.toContain('600,00');
    expect(html).toContain('Collega senza aggiungere');
});

it('does not show misleading results for an invalid preview', () => {
    const invalid = { valid: false, problem: 'Verifica gli anni.' };
    const html = renderPreview({
        ...preview,
        ...invalid,
        choices: { add: invalid, link: invalid },
    });
    expect(html).not.toContain('Il totale resta invariato.');
    expect(html).not.toContain('<dl');
    expect(html).not.toContain('Dettagli economici');
    expect(html.match(/disabled=""/g)).toHaveLength(2);
});

it.each([
    ['allocated', 'Allocato'],
    ['actual', 'Effettivo'],
    ['variance', 'Scostamento'],
] as const)(
    'omits unavailable %s details and retains zeros once',
    (key, label) => {
        mocks.detailsOpen = true;
        const values = {
            allocated: '0.00',
            actual: '0.00',
            variance: '0.00',
            [key]: null,
        };
        const html = renderPreview({
            ...preview,
            years: [
                {
                    ...preview.years[0],
                    expense_before: values,
                    expense_after: values,
                },
            ],
        });
        const detail = html.split('aria-label="Dettagli 2026"')[1];
        expect(detail).toContain('Importi della spesa');
        expect(detail).not.toContain(label);
        expect(detail.match(/0,00/g)).toHaveLength(2);
        expect(detail).not.toContain('Prima');
        expect(detail).not.toContain('Dopo');
        expect(detail).not.toContain('—');
    },
);

it('compares changed expense values and shows only known data', () => {
    mocks.detailsOpen = true;
    const html = renderPreview({
        ...preview,
        years: [
            {
                ...preview.years[0],
                expense_before: {
                    allocated: '10.00',
                    actual: null,
                    variance: '5.00',
                },
                expense_after: {
                    allocated: '20.00',
                    actual: '25.00',
                    variance: null,
                },
            },
        ],
    });
    const detail = html.split('aria-label="Dettagli 2026"')[1];
    for (const amount of ['10,00', '20,00', '25,00', '5,00'])
        expect(detail).toContain(amount);
    expect(detail).toContain('Prima: ');
    expect(detail).toContain('Dopo: ');
    expect(detail).not.toContain('—');
});
