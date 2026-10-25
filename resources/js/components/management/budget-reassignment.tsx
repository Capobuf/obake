import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
    Card,
    CardHeader,
    CardTitle,
    CardDescription,
    CardContent,
    CardFooter,
} from '@/components/ui/card';
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { api, money } from './helpers';
import type { RecordData } from './types';

type Values = {
    allocated: string | null;
    actual: string | null;
    variance: string | null;
};
type BudgetChoice = 'add' | 'link';
export type BudgetReassignmentPreview = {
    expense: { id: number; title: string };
    target: {
        type: 'contract' | 'project';
        id: number;
        name: string;
        year: number | null;
    };
    valid: boolean;
    problem: string | null;
    automatic: boolean;
    choices: Record<BudgetChoice, { valid: boolean; problem: string | null }>;
    token: string;
    years: {
        year: number;
        budget_id: number | null;
        direct_entries: { id: number }[];
        destination: 'present' | 'missing';
        expense_before: Values | null;
        expense_after: Values | null;
        budget_before: Values | null;
        budget_after: Record<BudgetChoice, (Values & { count: number }) | null>;
        difference: Record<BudgetChoice, Values>;
    }[];
};

export class BudgetReassignmentRequired extends Error {
    constructor(
        public url: string,
        public data: Record<string, unknown>,
        public afterSaved?: () => void,
    ) {
        super('Il collegamento cambia l’inclusione della spesa nel Budget.');
    }
}

const metrics = [
    ['allocated', 'Allocato'],
    ['actual', 'Effettivo'],
    ['variance', 'Scostamento'],
] as const;

function AmountRow({
    label,
    before,
    after,
    difference,
}: {
    label: string;
    before: string | null | undefined;
    after: string | null | undefined;
    difference?: string | null;
}) {
    if (before == null && after == null) return null;
    const changed = before !== after;
    return (
        <div
            className={cn(
                'grid items-baseline gap-x-4 gap-y-1 py-2',
                changed ? 'grid-cols-1' : 'grid-cols-[minmax(0,1fr)_auto]',
            )}
        >
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd
                className={cn(
                    'flex flex-wrap items-center gap-2 financial-value',
                    changed ? 'justify-start' : 'justify-end',
                )}
            >
                {changed && before != null && after != null ? (
                    <>
                        <span className="text-muted-foreground">
                            <span className="sr-only">Prima: </span>
                            {money(before)}
                        </span>
                        <ArrowRight
                            className="size-3.5 shrink-0 text-muted-foreground"
                            aria-hidden="true"
                        />
                        <span className="font-medium">
                            <span className="sr-only">Dopo: </span>
                            {money(after)}
                        </span>
                    </>
                ) : (
                    <>
                        {(before == null || after == null) && (
                            <span className="text-xs text-muted-foreground">
                                {before == null ? 'Dopo' : 'Prima'}
                            </span>
                        )}
                        <span className="font-medium">
                            {money(after ?? before)}
                        </span>
                    </>
                )}
                {difference != null && Number(difference) !== 0 && (
                    <Badge variant="secondary">
                        <span className="sr-only">Variazione: </span>
                        {Number(difference) > 0 ? '+' : ''}
                        {money(difference)}
                    </Badge>
                )}
            </dd>
        </div>
    );
}

export function BudgetReassignmentComparison({
    preview,
    onChoose,
    busy,
}: {
    preview: BudgetReassignmentPreview;
    onChoose: (choice: BudgetChoice) => void;
    busy: boolean;
}) {
    const targetLabel =
        preview.target.type === 'contract' ? 'Contratto' : 'Progetto';
    const missingTarget = preview.years.some(
        (year) => year.budget_id !== null && year.destination === 'missing',
    );
    const choices: BudgetChoice[] = missingTarget ? ['add', 'link'] : ['link'];
    const detailYears = preview.years.filter((year) =>
        metrics.some(
            ([key]) =>
                year.expense_before?.[key] != null ||
                year.expense_after?.[key] != null,
        ),
    );
    return (
        <div className="flex flex-col gap-5">
            <p className="text-sm [overflow-wrap:anywhere]">
                <strong>{preview.expense.title}</strong> →{' '}
                {targetLabel.toLowerCase()}{' '}
                <strong>{preview.target.name}</strong>
            </p>
            <div
                className={cn(
                    'grid items-stretch gap-4',
                    missingTarget && 'sm:grid-cols-2',
                )}
            >
                {choices.map((choice) => (
                    <Card
                        key={choice}
                        className="gap-4 py-4"
                        aria-label={
                            choice === 'add'
                                ? 'Aggiungi al Budget'
                                : 'Solo collegamento'
                        }
                    >
                        <CardHeader className="px-4">
                            <CardTitle>
                                {choice === 'add'
                                    ? 'Aggiungi anche al Budget'
                                    : missingTarget
                                      ? 'Collega soltanto'
                                      : 'Collega al contenitore nel Budget'}
                            </CardTitle>
                            <CardDescription>
                                {choice === 'add'
                                    ? `Entrano nel Budget anche le altre spese del ${targetLabel.toLowerCase()} per l’anno.`
                                    : missingTarget
                                      ? 'La spesa viene collegata, ma non conta nei Budget in cui questo è assente.'
                                      : 'Il contenitore è già nel Budget: anche questa spesa verrà conteggiata per l’anno.'}
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="flex flex-col gap-4 px-4">
                            {preview.choices[choice].valid ? (
                                preview.years.map((year) => {
                                    const after = year.budget_after[choice];
                                    const changed = metrics.filter(
                                        ([key]) =>
                                            year.budget_before?.[key] !==
                                            after?.[key],
                                    );
                                    const known = metrics.some(
                                        ([key]) =>
                                            year.budget_before?.[key] != null ||
                                            after?.[key] != null,
                                    );
                                    return (
                                        <section
                                            key={year.year}
                                            aria-label={`Budget ${year.year}`}
                                        >
                                            <h4 className="mb-2 text-sm font-medium">
                                                Budget {year.year}
                                            </h4>
                                            {year.budget_id === null ? (
                                                <p className="text-sm text-muted-foreground">
                                                    Nessun Budget per questo
                                                    anno.
                                                </p>
                                            ) : changed.length === 0 &&
                                              known ? (
                                                <p className="text-sm text-muted-foreground">
                                                    Il totale resta invariato.
                                                </p>
                                            ) : (
                                                <>
                                                    {after?.count === 0 && (
                                                        <p className="mb-2 text-sm text-muted-foreground">
                                                            Il Budget resterà
                                                            senza voci.
                                                        </p>
                                                    )}
                                                    <dl className="divide-y">
                                                        {changed.map(
                                                            ([key, label]) => (
                                                                <AmountRow
                                                                    key={key}
                                                                    label={
                                                                        label
                                                                    }
                                                                    before={
                                                                        year
                                                                            .budget_before?.[
                                                                            key
                                                                        ]
                                                                    }
                                                                    after={
                                                                        after?.[
                                                                            key
                                                                        ]
                                                                    }
                                                                    difference={
                                                                        year
                                                                            .difference[
                                                                            choice
                                                                        ][key]
                                                                    }
                                                                />
                                                            ),
                                                        )}
                                                    </dl>
                                                </>
                                            )}
                                        </section>
                                    );
                                })
                            ) : (
                                <Alert>
                                    <AlertDescription>
                                        {preview.choices[choice].problem}
                                    </AlertDescription>
                                </Alert>
                            )}
                        </CardContent>
                        <CardFooter className="mt-auto px-4">
                            <Button
                                type="button"
                                variant="outline"
                                className="h-auto w-full whitespace-normal"
                                disabled={
                                    busy || !preview.choices[choice].valid
                                }
                                onClick={() => onChoose(choice)}
                            >
                                {choice === 'add'
                                    ? 'Collega e aggiungi al Budget'
                                    : missingTarget
                                      ? 'Collega senza aggiungere'
                                      : 'Conferma collegamento'}
                            </Button>
                        </CardFooter>
                    </Card>
                ))}
            </div>
            {preview.valid && detailYears.length > 0 && (
                <Collapsible>
                    <CollapsibleTrigger asChild>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="group -ml-2"
                        >
                            Dettagli economici
                            <ChevronDown
                                className="group-data-[state=open]:rotate-180"
                                aria-hidden="true"
                            />
                        </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="pt-3">
                        <div className="flex flex-col gap-5">
                            {detailYears.map((year) => (
                                <section
                                    key={year.year}
                                    aria-label={`Dettagli ${year.year}`}
                                >
                                    <h4 className="mb-2 text-sm font-medium">
                                        Importi della spesa · {year.year}
                                    </h4>
                                    <dl className="divide-y">
                                        {metrics.map(([key, label]) => (
                                            <AmountRow
                                                key={key}
                                                label={label}
                                                before={
                                                    year.expense_before?.[key]
                                                }
                                                after={
                                                    year.expense_after?.[key]
                                                }
                                            />
                                        ))}
                                    </dl>
                                </section>
                            ))}
                        </div>
                    </CollapsibleContent>
                </Collapsible>
            )}
        </div>
    );
}

export function BudgetReassignment({
    request,
    onClose,
    onSaved,
    returnFocus,
}: {
    request: BudgetReassignmentRequired;
    onClose: () => void;
    onSaved: (record: RecordData) => void;
    returnFocus?: () => void;
}) {
    const [preview, setPreview] = useState<BudgetReassignmentPreview | null>(
        null,
    );
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [revision, setRevision] = useState(0);
    const cancelButton = useRef<HTMLButtonElement>(null);
    const [opener] = useState(() =>
        typeof document === 'undefined' ? null : document.activeElement,
    );
    useEffect(() => {
        let active = true;
        api<BudgetReassignmentPreview>(
            `${request.url}/budget-reassignment/preview`,
            'PATCH',
            request.data,
        )
            .then((data) => {
                if (active) setPreview(data);
            })
            .catch((failure: unknown) => {
                if (active)
                    setError(
                        failure instanceof Error
                            ? failure.message
                            : 'Anteprima non disponibile.',
                    );
            })
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, [request, revision]);
    async function confirm(choice: BudgetChoice) {
        if (!preview?.choices[choice].valid || loading || busy) return;
        setBusy(true);
        setError('');
        try {
            const result = await api<{ record: RecordData }>(
                `${request.url}/budget-reassignment`,
                'PATCH',
                {
                    ...request.data,
                    token: preview.token,
                    confirmed: true,
                    choice,
                },
            );
            toast.success('Spesa collegata. Budget aggiornato.');
            onSaved(result.record);
        } catch (failure) {
            setPreview(null);
            setError(
                failure instanceof Error
                    ? failure.message
                    : 'Operazione non riuscita. Ricarica l’anteprima.',
            );
        } finally {
            setBusy(false);
        }
    }
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open && !busy) onClose();
            }}
        >
            <DialogContent
                className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
                aria-busy={busy || loading}
                onOpenAutoFocus={(event) => {
                    event.preventDefault();
                    cancelButton.current?.focus();
                }}
                onCloseAutoFocus={(event) => {
                    event.preventDefault();
                    if (returnFocus) returnFocus();
                    else if (opener instanceof HTMLElement) opener.focus();
                }}
            >
                <DialogHeader className="shrink-0 px-6 pt-6 pb-4 text-left">
                    <DialogTitle>Come vuoi collegare questa spesa?</DialogTitle>
                    <DialogDescription>
                        Verifica l’effetto del collegamento sul Budget prima di
                        confermare. La spesa e il contenitore di partenza non
                        vengono eliminati.
                    </DialogDescription>
                </DialogHeader>
                <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 pb-4">
                    {loading && <p role="status">Caricamento anteprima…</p>}
                    {error && (
                        <Alert variant="destructive">
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}
                    {preview && (
                        <BudgetReassignmentComparison
                            preview={preview}
                            onChoose={(choice) => void confirm(choice)}
                            busy={busy || loading}
                        />
                    )}
                </div>
                <DialogFooter className="shrink-0 gap-2 border-t px-6 py-4 sm:flex-wrap">
                    <Button
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={onClose}
                        ref={cancelButton}
                    >
                        Annulla
                    </Button>
                    {error && (
                        <Button
                            type="button"
                            variant="outline"
                            disabled={busy || loading}
                            onClick={() => {
                                setPreview(null);
                                setError('');
                                setLoading(true);
                                setRevision((value) => value + 1);
                            }}
                        >
                            Ricarica anteprima
                        </Button>
                    )}
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
