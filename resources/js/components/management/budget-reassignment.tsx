import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { api } from './helpers';
import type { RecordData } from './types';

import { BudgetLinkPreview, budgetLinkChoices } from './budget-link-preview';
import type {
    BudgetChoice,
    BudgetReassignmentPreview,
} from './budget-link-preview';

export class BudgetReassignmentRequired extends Error {
    constructor(
        public url: string,
        public data: Record<string, unknown>,
        public afterSaved?: () => void,
    ) {
        super('Il collegamento cambia l’inclusione della spesa nel Budget.');
    }
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
                className={cn(
                    'flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0',
                    preview && budgetLinkChoices(preview).length > 1
                        ? 'sm:max-w-3xl'
                        : 'sm:max-w-xl',
                )}
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
                    <DialogTitle>Collega la spesa</DialogTitle>
                    <DialogDescription>
                        Verifica l’effetto sul Budget. La spesa e il contenitore
                        di partenza vengono conservati.
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
                        <BudgetLinkPreview
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
