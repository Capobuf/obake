import { Link, usePage } from '@inertiajs/react';
import AppLogo from '@/components/app-logo';
import { NavMain } from '@/components/nav-main';
import { NavUser } from '@/components/nav-user';
import { TenantSwitcher } from '@/components/tenant-switcher';
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
} from '@/components/ui/sidebar';
import {
    getAdministrativeNavItems,
    getPrimaryNavItems,
} from '@/lib/app-navigation';

export function AppSidebar() {
    const { auth, currentTenant } = usePage().props;
    const homeHref = currentTenant
        ? `/t/${currentTenant.slug}/dashboard`
        : auth.canManagePlatform
          ? '/platform'
          : '/dashboard';
    const homeLabel = currentTenant
        ? `Vai alla home di ${currentTenant.name}`
        : auth.canManagePlatform
          ? 'Vai ad Amministrazione'
          : 'La mia azienda';

    return (
        <Sidebar
            collapsible="icon"
            variant="inset"
            role="navigation"
            aria-label="Navigazione principale"
        >
            <SidebarHeader className="gap-4 p-3 group-data-[collapsible=icon]:px-2">
                <SidebarMenu>
                    <SidebarMenuItem>
                        <SidebarMenuButton
                            size="lg"
                            className="h-14 justify-center"
                            asChild
                        >
                            <Link
                                href={homeHref}
                                aria-label={homeLabel}
                                prefetch
                            >
                                <AppLogo />
                            </Link>
                        </SidebarMenuButton>
                    </SidebarMenuItem>
                </SidebarMenu>
                <TenantSwitcher />
            </SidebarHeader>

            <SidebarContent>
                {(currentTenant || !auth.canManagePlatform) && (
                    <NavMain
                        items={getPrimaryNavItems(
                            currentTenant,
                            auth.canManagePlatform,
                        )}
                    />
                )}
                {currentTenant && (
                    <NavMain
                        items={getAdministrativeNavItems(currentTenant, false)}
                        label="Azienda"
                    />
                )}
            </SidebarContent>

            <SidebarFooter className="border-t border-sidebar-border px-0 py-3">
                {auth.canManagePlatform && (
                    <NavMain items={getAdministrativeNavItems(null, true)} />
                )}
                <div className="px-3">
                    <NavUser />
                </div>
            </SidebarFooter>
        </Sidebar>
    );
}
