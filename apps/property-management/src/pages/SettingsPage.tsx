import { ChevronDown, Settings } from 'lucide-react';
import { lazy, Suspense, type ComponentType } from 'react';
import { Navigate, NavLink, useParams } from 'react-router-dom';
import { cn } from '@project/components/lib/utils';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@project/components/ui/dropdown-menu';
import { SECTIONS, sectionPath, type SectionDef, type SectionKey } from '../components/settings/data';
import { SectionSkeleton } from '../components/settings/form';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useWorkspace } from '../lib/workspace';

const VIEWS: Record<SectionKey, ComponentType> = {
  profile: lazy(() => import('../components/settings/ProfileSection')),
  general: lazy(() => import('../components/settings/OrganizationSection')),
  rent: lazy(() => import('../components/settings/RentFeesSection')),
  leasing: lazy(() => import('../components/settings/LeasingSection')),
  maintenance: lazy(() => import('../components/settings/MaintenanceSection')),
  portal: lazy(() => import('../components/settings/PortalSection')),
  team: lazy(() => import('../components/settings/TeamSection')),
  roles: lazy(() => import('../components/settings/RolesSection')),
  templates: lazy(() => import('../components/settings/TemplatesSection')),
  automation: lazy(() => import('../components/settings/AutomationSection')),
  integrations: lazy(() => import('../components/settings/IntegrationsSection')),
  demo: lazy(() => import('../components/settings/DemoDataSection')),
};

/**
 * Settings: a sub-navigation of focused sections, Linear-style. Admins see
 * the organization, people and workspace sections; everyone sees Profile.
 * Sections that edit values save through a bar that appears only when
 * something changed (see components/settings/form.tsx).
 */
export function SettingsPage() {
  const ws = useWorkspace();
  const { section } = useParams();
  const allowed = SECTIONS.filter(s => !s.need || ws.can(s.need));
  const current = allowed.find(s => s.key === section);
  // Demo data is only listed while the sample is loaded (and stays put while it's open, so finishing a removal doesn't move you).
  const sections = allowed.filter(s => s.key !== 'demo' || Boolean(ws.settings.seededAt) || s.key === current?.key);
  useDocumentTitle(current ? `${current.label} · Settings` : 'Settings');

  if (!current) return <Navigate to={sectionPath(ws.can('settings.manage') ? 'general' : 'profile')} replace />;
  const View = VIEWS[current.key];
  const groups = [...new Set(sections.map(s => s.group))];

  return (
    <>
      <PageHeader
        icon={<Settings />}
        title="Settings"
        actions={
          sections.length > 1 && (
            <div className="md:hidden">
              <MobileSectionMenu sections={sections} groups={groups} current={current} />
            </div>
          )
        }
      />
      <div className="flex min-h-0 flex-1">
        {sections.length > 1 && (
          <nav aria-label="Settings sections" className="hidden w-[228px] shrink-0 overflow-y-auto border-r bg-subtle/40 px-2.5 py-5 md:block">
            {groups.map(g => (
              <div key={g} className="mb-5 last:mb-0">
                <div className="flex h-8 items-center px-2 text-sm font-medium text-muted-foreground">{g}</div>
                <div className="space-y-px">
                  {sections.filter(s => s.group === g).map(s => (
                    <NavLink
                      key={s.key}
                      to={sectionPath(s.key)}
                      className={({ isActive }) =>
                        cn('flex h-8 items-center rounded-md px-2 text-[14px] transition-colors', isActive ? 'bg-accent font-medium text-foreground' : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground')
                      }
                    >
                      {s.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
          </nav>
        )}
        <div key={current.key} className="min-w-0 flex-1 overflow-y-auto" data-settings-scroll>
          <div className={cn('mx-auto w-full px-4 pb-16 pt-6 sm:px-8 sm:pt-10', current.key === 'team' || current.key === 'roles' ? 'max-w-[940px]' : 'max-w-[760px]')}>
            <Suspense fallback={<SectionSkeleton />}>
              <View />
            </Suspense>
          </div>
        </div>
      </div>
    </>
  );
}

function MobileSectionMenu({ sections, groups, current }: { sections: SectionDef[]; groups: string[]; current: SectionDef }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="inline-flex h-8 max-w-[200px] items-center gap-1.5 rounded-md border bg-background px-2.5 text-[13.5px] font-medium shadow-2xs data-[state=open]:bg-accent">
          <span className="truncate">{current.label}</span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        {groups.map((g, i) => (
          <div key={g}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-sm font-medium text-muted-foreground">{g}</DropdownMenuLabel>
            {sections.filter(s => s.group === g).map(s => (
              <DropdownMenuItem key={s.key} asChild className={cn('text-[14px]', s.key === current.key && 'bg-accent font-medium')}>
                <NavLink to={sectionPath(s.key)}>{s.label}</NavLink>
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
