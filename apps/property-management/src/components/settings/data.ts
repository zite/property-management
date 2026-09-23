import { useQuery } from '@tanstack/react-query';
import {
  clearDemoData, getOrgSettings, listEmailTemplates, listTeamMembers,
  type GetOrgSettingsOutputType, type ListEmailTemplatesOutputType, type ListTeamMembersOutputType,
} from 'zitejs/api';
import type { Capability } from '@project/shared/roles';
import { qk } from '../../lib/queries';

/**
 * Settings data. Everything lives under the `settings` query root; a save
 * writes through its endpoint, then invalidates this root and `bootstrap`
 * (which carries the settings every other screen reads).
 */

export type OrgSettingsData = GetOrgSettingsOutputType;
export type OrgSettings = OrgSettingsData['settings'];
export type TeamMember = ListTeamMembersOutputType['members'][number];
export type EmailTemplate = ListEmailTemplatesOutputType['templates'][number];

export const sk = {
  org: [...qk.settings, 'org'] as const,
  team: [...qk.settings, 'team'] as const,
  templates: [...qk.settings, 'templates'] as const,
  demo: [...qk.settings, 'demo'] as const,
};

export function useOrgSettings(enabled = true) {
  return useQuery({ queryKey: sk.org, queryFn: () => getOrgSettings({}), staleTime: 30_000, enabled });
}

export function useTeam(enabled = true) {
  return useQuery({ queryKey: sk.team, queryFn: () => listTeamMembers({}), staleTime: 15_000, enabled });
}

export function useEmailTemplates(enabled = true) {
  return useQuery({ queryKey: sk.templates, queryFn: () => listEmailTemplates({}), staleTime: 30_000, enabled });
}

export function useDemoCounts(enabled = true) {
  return useQuery({ queryKey: sk.demo, queryFn: () => clearDemoData({ dryRun: true }), staleTime: 10_000, enabled });
}

export type SectionKey =
  | 'general' | 'rent' | 'leasing' | 'maintenance' | 'portal'
  | 'team' | 'roles'
  | 'templates' | 'automation' | 'integrations'
  | 'demo' | 'profile';

export type SectionDef = { key: SectionKey; label: string; group: string; need?: Capability; description: string };

/** The settings sections in nav order. `need` hides a section from roles that can't use it. */
export const SECTIONS: SectionDef[] = [
  { key: 'profile', label: 'Profile', group: 'Account', description: 'How you appear to your team, and how the app looks for you.' },
  { key: 'general', label: 'Organization', group: 'Company', need: 'settings.manage', description: 'Your company’s name, brand and contact details, used in emails and the portal.' },
  { key: 'rent', label: 'Rent & fees', group: 'Company', need: 'settings.manage', description: 'When rent is due, how late fees work and how residents pay.' },
  { key: 'leasing', label: 'Leasing', group: 'Company', need: 'settings.manage', description: 'Applications, renewals and the lease agreement residents sign.' },
  { key: 'maintenance', label: 'Maintenance & owners', group: 'Company', need: 'settings.manage', description: 'Management fees, owner approvals and maintenance requests.' },
  { key: 'portal', label: 'Resident portal', group: 'Company', need: 'settings.manage', description: 'What residents, owners and applicants see when they sign in.' },
  { key: 'team', label: 'Team', group: 'People', need: 'members.manage', description: 'Invite teammates, change roles and remove access.' },
  { key: 'roles', label: 'Roles & permissions', group: 'People', need: 'members.manage', description: 'What each role can see and do.' },
  { key: 'templates', label: 'Email templates', group: 'Workspace', need: 'settings.manage', description: 'The emails sent automatically, and templates for writing your own.' },
  { key: 'automation', label: 'Automation', group: 'Workspace', need: 'settings.manage', description: 'The work that runs every morning so nobody has to remember it.' },
  { key: 'integrations', label: 'Integrations', group: 'Workspace', need: 'settings.manage', description: 'Email, AI and online payments.' },
  { key: 'demo', label: 'Demo data', group: 'Workspace', need: 'settings.manage', description: 'The sample company that was set up, and removing it when you’re ready.' },
];

export const sectionPath = (key: SectionKey) => `/settings/${key}`;
