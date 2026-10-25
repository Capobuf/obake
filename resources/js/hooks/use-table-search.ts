import { router } from '@inertiajs/react';
import { useEffect, useRef, useState } from 'react';
import type { Filters } from '@/components/management/types';

export function useTableSearch(path: string, filters: Filters) {
    const [search, setSearch] = useState(filters.search ?? '');
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const cancel = useRef<(() => void) | undefined>(undefined);
    const edits = useRef(0);
    const visitEdit = useRef(0);
    const currentFilters = useRef(filters);
    useEffect(() => {
        currentFilters.current = filters;
    }, [filters]);

    useEffect(() => {
        const contextKey = (url: URL) =>
            JSON.stringify([
                url.pathname,
                url.searchParams.get('year'),
                url.searchParams.get('history'),
            ]);
        let context = contextKey(new URL(window.location.href));
        const before = router.on('before', () => {
            visitEdit.current = edits.current;
        });
        const popstate = () => {
            visitEdit.current = edits.current;
        };
        window.addEventListener('popstate', popstate);
        const unsubscribe = router.on('navigate', ({ detail }) => {
            const url = new URL(detail.page.url, window.location.origin);
            const nextContext = contextKey(url);
            // A response started before the latest keystroke must not replace that draft.
            if (context === nextContext && visitEdit.current < edits.current)
                return;
            context = nextContext;
            clearTimeout(timer.current);
            setSearch(url.searchParams.get('search') ?? '');
        });
        return () => {
            before();
            unsubscribe();
            window.removeEventListener('popstate', popstate);
            clearTimeout(timer.current);
            cancel.current?.();
        };
    }, []);

    function changeSearch(value: string) {
        edits.current += 1;
        setSearch(value);
        clearTimeout(timer.current);
        cancel.current?.();
        timer.current = setTimeout(() => {
            const params = Object.fromEntries(
                Object.entries({
                    ...currentFilters.current,
                    search: value.trim(),
                    page: 1,
                }).filter(
                    ([, item]) =>
                        item !== '' && item !== undefined && item !== null,
                ),
            );
            router.get(path, params, {
                preserveState: true,
                preserveScroll: true,
                replace: true,
                onCancelToken: (token) => {
                    cancel.current = () => token.cancel();
                },
            });
        }, 300);
    }

    return [search, changeSearch] as const;
}
