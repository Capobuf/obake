import { Search, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
    InputGroup,
    InputGroupAddon,
    InputGroupButton,
    InputGroupInput,
} from '@/components/ui/input-group';
import { cn } from '@/lib/utils';

export function TableSearchInput({
    value,
    onChange,
    disabled = false,
    label = 'Cerca in questa tabella',
    placeholder = 'Cerca in questa tabella…',
}: {
    value: string;
    onChange: (value: string) => void;
    disabled?: boolean;
    label?: string;
    placeholder?: string;
}) {
    const id = useId();
    const root = useRef<HTMLDivElement>(null);
    const input = useRef<HTMLInputElement>(null);
    const trigger = useRef<HTMLButtonElement>(null);
    const [expanded, setExpanded] = useState(!!value);
    useEffect(() => {
        if (!expanded) return;
        const outside = (event: PointerEvent) => {
            if (!root.current?.contains(event.target as Node))
                setExpanded(false);
        };
        document.addEventListener('pointerdown', outside);
        return () => document.removeEventListener('pointerdown', outside);
    }, [expanded]);
    function collapse() {
        setExpanded(false);
        requestAnimationFrame(() => trigger.current?.focus());
    }
    return (
        <div
            id={id}
            ref={root}
            onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                    setExpanded(false);
            }}
            className={cn(
                'shrink-0 overflow-hidden transition-[width] duration-200 ease-out motion-reduce:transition-none',
                expanded ? 'w-full sm:w-72' : 'w-9',
            )}
        >
            {expanded ? (
                <InputGroup
                    className="min-w-0 animate-in duration-200 fade-in has-[[data-slot=input-group-control]:focus-visible]:border-foreground/30 has-[[data-slot=input-group-control]:focus-visible]:ring-foreground/10 motion-reduce:animate-none"
                    data-disabled={disabled}
                >
                    <InputGroupInput
                        ref={input}
                        type="search"
                        className="[&::-webkit-search-cancel-button]:hidden"
                        aria-label={label}
                        placeholder={placeholder}
                        value={value}
                        disabled={disabled}
                        onChange={(event) => onChange(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Escape') collapse();
                        }}
                    />
                    <InputGroupAddon>
                        <InputGroupButton
                            size="icon-sm"
                            aria-label="Comprimi ricerca"
                            aria-expanded="true"
                            aria-controls={id}
                            disabled={disabled}
                            className="focus-visible:border-foreground/30 focus-visible:ring-foreground/20"
                            onClick={collapse}
                        >
                            <Search aria-hidden="true" />
                        </InputGroupButton>
                    </InputGroupAddon>
                    {value && (
                        <InputGroupAddon align="inline-end">
                            <InputGroupButton
                                size="icon-sm"
                                aria-label="Cancella ricerca"
                                className="focus-visible:border-foreground/30 focus-visible:ring-foreground/20"
                                disabled={disabled}
                                onClick={() => {
                                    setExpanded(true);
                                    onChange('');
                                    input.current?.focus();
                                }}
                            >
                                <X aria-hidden="true" />
                            </InputGroupButton>
                        </InputGroupAddon>
                    )}
                </InputGroup>
            ) : (
                <Button
                    ref={trigger}
                    variant={value ? 'secondary' : 'outline'}
                    size="icon"
                    className="focus-visible:border-foreground/30 focus-visible:ring-foreground/20"
                    aria-label={label}
                    aria-expanded="false"
                    aria-controls={id}
                    disabled={disabled}
                    onClick={() => {
                        setExpanded(true);
                        requestAnimationFrame(() => input.current?.focus());
                    }}
                >
                    <Search aria-hidden="true" />
                </Button>
            )}
        </div>
    );
}
