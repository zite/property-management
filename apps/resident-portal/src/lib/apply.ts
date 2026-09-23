import { useQuery } from '@tanstack/react-query';
import { getMyApplication, listMyApplications, type GetMyApplicationOutputType, type ListMyApplicationsOutputType } from 'zitejs/api';
import type { Tone } from '@project/shared/tone';
import { useSession } from './auth';
import { retry } from './queries';

/**
 * Rental applications from the applicant's side: queries, and what each
 * status means in words a person applying for a home would use.
 */

export type MyApplication = ListMyApplicationsOutputType['applications'][number];
export type ApplicationDetail = GetMyApplicationOutputType;
export type ApplicationData = NonNullable<GetMyApplicationOutputType['application']>;

export const applicationKeys = {
  all: ['portal', 'applications'] as const,
  list: ['portal', 'applications', 'list'] as const,
  detail: (id: string) => ['portal', 'applications', 'detail', id] as const,
  forListing: (slug: string) => ['portal', 'applications', 'listing', slug] as const,
};

export function useMyApplications() {
  const { user } = useSession();
  return useQuery({ queryKey: applicationKeys.list, queryFn: () => listMyApplications({}), enabled: Boolean(user), staleTime: 15_000, retry });
}

export function useMyApplication(id: string | undefined) {
  const { user } = useSession();
  return useQuery({ queryKey: applicationKeys.detail(id ?? ''), queryFn: () => getMyApplication({ id: id! }), enabled: Boolean(user && id), staleTime: 10_000, retry });
}

export function useApplicationForListing(slug: string | undefined) {
  const { user } = useSession();
  return useQuery({
    queryKey: applicationKeys.forListing(slug ?? ''),
    queryFn: () => getMyApplication({ slug: slug! }),
    enabled: Boolean(user && slug),
    // Always start from what the server has (another tab or device may have saved since)…
    refetchOnMount: 'always',
    // …but once the editor is open, never refetch underneath someone's typing.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    retry,
  });
}

export function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export type StatusCopy = { pill: string; tone: Tone; headline: string; body: string };

/** One line for a list row, where the status pill already names the status. */
export const STATUS_LINE: Record<string, string> = {
  Draft: 'Not sent yet',
  Submitted: 'We’ll review it within 2 business days',
  Screening: 'We’re checking income, rental history and references',
  Approved: 'Your lease is on the way',
  Denied: 'Open for details and your rights',
  Withdrawn: 'You withdrew this application',
  Leased: 'Welcome home',
};

/**
 * Plain-language status. A denial says no more than an adverse-action notice
 * should: the reason stays with the leasing team, and the applicant is told
 * how to ask about a screening report.
 */
export function statusCopy(status: string, org = 'the leasing team'): StatusCopy {
  switch (status) {
    case 'Draft':
      return { pill: 'Draft', tone: 'neutral', headline: 'Finish your application', body: 'Your answers are saved. Pick up where you left off and submit when you’re ready.' };
    case 'Submitted':
      return { pill: 'Received', tone: 'info', headline: 'Received — we’ll review within 2 business days', body: `${org} reviews applications in the order they arrive. You’ll get an email as soon as there’s news, and you can message the office here any time.` };
    case 'Screening':
      return { pill: 'Under review', tone: 'warning', headline: 'Under review', body: 'We’re verifying your income, rental history and references. This usually takes a day or two. If we need anything else, we’ll ask here and by email.' };
    case 'Approved':
      return { pill: 'Approved', tone: 'success', headline: 'Approved — your lease is on the way', body: 'Congratulations. We’re preparing your lease and will send it for electronic signature shortly, along with move-in details.' };
    case 'Denied':
      return {
        pill: 'Not approved',
        tone: 'danger',
        headline: 'Not approved',
        body: 'After reviewing your application, we’re unable to approve it at this time. If our decision was based on information from a consumer reporting agency, you have the right to a free copy of that report within 60 days and to dispute its accuracy. Send us a message below and we’ll share the agency’s contact details.',
      };
    case 'Withdrawn':
      return { pill: 'Withdrawn', tone: 'neutral', headline: 'Withdrawn', body: 'You withdrew this application, so it won’t be reviewed. You can apply again from the listing while the home is available.' };
    case 'Leased':
      return { pill: 'Leased', tone: 'accent', headline: 'Welcome home', body: 'Your lease is signed. Your resident portal is where you’ll pay rent, request maintenance and find your documents.' };
    default:
      return { pill: status, tone: 'neutral', headline: status, body: '' };
  }
}
