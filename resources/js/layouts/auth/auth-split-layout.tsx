import { Link, usePage } from '@inertiajs/react';
import AppLogoIcon from '@/components/app-logo-icon';
import { cn } from '@/lib/utils';
import { home } from '@/routes';
import type { AuthLayoutProps } from '@/types';

export default function AuthSplitLayout({
    children,
    title,
    description,
    logoOnly = false,
    showLogo = false,
}: AuthLayoutProps) {
    const { name } = usePage().props;

    return (
        <div className="grid min-h-svh items-center bg-card text-card-foreground lg:grid-cols-2">
            <aside
                className="hidden self-stretch border-r bg-sidebar bg-cover bg-center p-10 text-sidebar-foreground lg:flex lg:flex-col"
                style={{
                    backgroundImage: 'var(--auth-background)',
                }}
            >
                <Link
                    href={home()}
                    className="flex w-fit items-center gap-2 rounded-lg bg-sidebar p-3 text-lg font-medium shadow-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
                >
                    <AppLogoIcon className="size-10" />
                    {name}
                </Link>
            </aside>
            <main className="min-w-0 px-6 py-10 sm:px-8">
                <div className="mx-auto flex w-full max-w-sm flex-col gap-6">
                    <Link
                        href={home()}
                        className={cn(
                            'mx-auto flex flex-col items-center gap-2 rounded-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring',
                            !logoOnly && !showLogo && 'lg:hidden',
                        )}
                    >
                        <AppLogoIcon className="size-16" />
                        {!logoOnly && !showLogo && name}
                    </Link>
                    <div
                        className={cn(
                            'flex flex-col items-center gap-2 text-center',
                            logoOnly && 'sr-only',
                        )}
                    >
                        <h1 className="text-2xl font-semibold tracking-tight">
                            {title}
                        </h1>
                        {description && (
                            <p className="text-sm text-balance text-muted-foreground">
                                {description}
                            </p>
                        )}
                    </div>
                    {children}
                </div>
            </main>
        </div>
    );
}
