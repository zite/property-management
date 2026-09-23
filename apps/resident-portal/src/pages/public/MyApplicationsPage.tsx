import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ChevronRight, ClipboardList, MessageSquare, Search, Trash2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { withdrawApplication } from 'zitejs/api';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ListingPhoto } from '../../components/homes/ListingPhoto';
import { SignInPrompt } from '../../components/SignInPrompt';
import { Alert, Button, Card, Container, EmptyState, LinkButton, ProgressBar, Skeleton, StatusPill } from '../../components/ui';
import { STATUS_LINE, applicationKeys, statusCopy, useMyApplications, type MyApplication } from '../../lib/apply';
import { useSession } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { firstName, shortDate, timeAgo } from '../../lib/format';
import { homesKeys, money, sizeLine } from '../../lib/listings';
import { qk, useMe, usePortal } from '../../lib/queries';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

/** Every application you've started or sent, with the one thing to do next on each. */
export default function MyApplicationsPage() {
  useDocumentTitle('My applications');
  const { user, isLoading, name } = useSession();
  const me = useMe();
  const q = useMyApplications();

  if (isLoading) return <ListSkeleton />;
  if (!user) return <SignInPrompt title="Sign in to see your applications" body="Use the email address you applied with to finish a draft, check a status or message the leasing team." hashPath="/applications" />;

  const greeting = firstName(me.data?.name || name);
  return (
    <div className="pb-12">
      <div className="border-b bg-background">
        <Container className="flex flex-col gap-4 py-7 sm:flex-row sm:items-end sm:justify-between sm:py-9">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">My applications</h1>
            <p className="mt-1.5 text-[15px] text-muted-foreground">
              {greeting ? `Hi ${greeting}. ` : ''}Homes you’ve applied for, and where each application stands.
            </p>
          </div>
          <LinkButton to="/homes" variant="secondary" className="self-start sm:self-auto">
            <Search aria-hidden /> Browse homes
          </LinkButton>
        </Container>
      </div>
      <Container className="pt-6 sm:pt-8">
        {q.isPending ? (
          <ListBody />
        ) : q.isError || !q.data ? (
          <Alert tone="danger" title="Your applications didn’t load" action={<Button variant="secondary" size="sm" onClick={() => q.refetch()}>Try again</Button>}>
            {errorMessage(q.error, 'Check your connection and try again.')}
          </Alert>
        ) : (
          <Applications items={q.data.applications} />
        )}
      </Container>
    </div>
  );
}

function Applications({ items }: { items: MyApplication[] }) {
  const qc = useQueryClient();
  const [deleting, setDeleting] = useState<MyApplication | null>(null);
  const { user } = useSession();
  const remove = useMutation({
    mutationFn: (id: string) => withdrawApplication({ id, reason: '' }),
    onMutate: async id => {
      await qc.cancelQueries({ queryKey: applicationKeys.list });
      const previous = qc.getQueryData<{ applications: MyApplication[] }>(applicationKeys.list);
      qc.setQueryData<{ applications: MyApplication[] }>(applicationKeys.list, prev => (prev ? { applications: prev.applications.filter(a => a.id !== id) } : prev));
      return { previous };
    },
    onSuccess: (_res, id) => {
      const draft = items.find(a => a.id === id);
      try {
        if (draft) localStorage.removeItem(`resident-portal:apply:${user?.email ?? ''}:${draft.listing.slug}`);
      } catch {
        /* ignore */
      }
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: applicationKeys.all });
      void qc.invalidateQueries({ queryKey: qk.me });
      void qc.invalidateQueries({ queryKey: homesKeys.all });
      toast.success('Draft deleted.');
    },
    onError: (e, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(applicationKeys.list, ctx.previous);
      toast.error(errorMessage(e, 'The draft wasn’t deleted. Try again.'));
    },
  });

  if (items.length === 0) {
    return (
      <Card>
        <EmptyState icon={ClipboardList} title="You haven’t applied for a home yet" action={<LinkButton to="/homes">Browse homes for rent <ArrowRight aria-hidden /></LinkButton>}>
          Find a home you like and apply online in about ten minutes. Your answers save as you go, so you can finish later.
        </EmptyState>
      </Card>
    );
  }

  const drafts = items.filter(a => a.status === 'Draft');
  const sent = items.filter(a => a.status !== 'Draft');
  return (
    <div className="space-y-10">
      {drafts.length > 0 && (
        <Section title="Finish applying" count={drafts.length} description="Not sent yet. Your answers are saved.">
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {drafts.map(d => (
              <li key={d.id}>
                <DraftCard app={d} onDelete={() => setDeleting(d)} />
              </li>
            ))}
          </ul>
        </Section>
      )}
      {sent.length > 0 && (
        <Section title={drafts.length ? 'Sent' : 'Your applications'} count={sent.length}>
          <ul className="divide-y overflow-hidden rounded-xl border bg-card shadow-xs">
            {sent.map(a => (
              <li key={a.id}>
                <SentRow app={a} />
              </li>
            ))}
          </ul>
        </Section>
      )}
      <ConfirmDialog
        open={deleting != null}
        onOpenChange={o => !o && setDeleting(null)}
        title="Delete this draft?"
        description={deleting ? `Your saved answers for ${deleting.listing.title} will be deleted. You can start again any time the home is listed.` : ''}
        confirmLabel="Delete draft"
        tone="danger"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id)}
      />
    </div>
  );
}

function Section({ title, count, description, children }: { title: string; count: number; description?: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-4">
        <h2 className="flex items-baseline gap-2 text-lg font-semibold tracking-tight">
          {title} <span className="text-sm font-normal tabular-nums text-muted-foreground">{count}</span>
        </h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function DraftCard({ app, onDelete }: { app: MyApplication; onDelete: () => void }) {
  const portal = usePortal();
  const currency = portal.data?.settings.currency ?? 'USD';
  const l = app.listing;
  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <div className="flex gap-4 p-4 sm:p-5">
        <ListingPhoto src={l.cover} alt="" width={320} className="h-20 w-24 shrink-0 rounded-lg sm:h-24 sm:w-32" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm text-muted-foreground">{[l.propertyName, l.city].filter(Boolean).join(' · ')}</p>
          <h3 className="line-clamp-2 font-semibold leading-snug">{l.title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {l.rent != null ? `${money(l.rent, currency)}/mo` : ''}
            {sizeLine(l) ? ` · ${sizeLine(l)}` : ''}
          </p>
        </div>
      </div>
      <div className="px-4 sm:px-5">
        <div className="mb-1.5 flex justify-between gap-3 text-sm">
          <span className="font-medium">
            {app.stepsDone} of {app.stepsTotal} sections done
          </span>
          <span className="text-muted-foreground">{app.lastActivityAt ? `Saved ${timeAgo(app.lastActivityAt)}` : ''}</span>
        </div>
        <ProgressBar value={app.stepsDone / Math.max(1, app.stepsTotal)} label={`${l.title} progress`} />
      </div>
      <div className="mt-auto flex items-center justify-between gap-2 p-4 pt-5 sm:px-5">
        <Button variant="ghost" size="sm" className="-ml-2 text-muted-foreground hover:text-tone-danger" onClick={onDelete} aria-label={`Delete draft for ${l.title}`}>
          <Trash2 aria-hidden /> Delete
        </Button>
        {l.published ? (
          <LinkButton to={`/homes/${l.slug}/apply`} size="sm">
            Continue <ArrowRight aria-hidden />
          </LinkButton>
        ) : (
          <span className="text-sm text-muted-foreground">No longer listed</span>
        )}
      </div>
    </Card>
  );
}

function SentRow({ app }: { app: MyApplication }) {
  const copy = statusCopy(app.status);
  const l = app.listing;
  return (
    <Link to={`/applications/${app.id}`} className="group flex items-center gap-4 p-4 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/35 sm:px-5">
      <ListingPhoto src={l.cover} alt="" width={320} className="h-16 w-20 shrink-0 rounded-lg sm:h-20 sm:w-28" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <StatusPill tone={copy.tone}>{copy.pill}</StatusPill>
          <span className="text-sm text-muted-foreground">
            {app.reference}
            {app.submittedAt ? ` · sent ${shortDate(app.submittedAt)}` : ''}
          </span>
        </div>
        <h3 className="mt-1 truncate font-semibold group-hover:underline group-hover:decoration-foreground/30 group-hover:underline-offset-4">{l.title}</h3>
        <p className="truncate text-sm text-muted-foreground">{STATUS_LINE[app.status] ?? copy.headline}</p>
      </div>
      {app.unreadMessages > 0 && (
        <span className="hidden shrink-0 items-center gap-1.5 rounded-full bg-primary/[0.08] px-2.5 py-1 text-sm font-medium text-primary sm:inline-flex">
          <MessageSquare className="h-4 w-4" aria-hidden /> {app.unreadMessages} new
        </span>
      )}
      {app.unreadMessages > 0 && <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary sm:hidden" aria-label={`${app.unreadMessages} new messages`} />}
      <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}

function ListBody() {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      <Skeleton className="h-5 w-40" />
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 rounded-xl border bg-card p-4">
          <Skeleton className="h-20 w-28 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-6 w-32 rounded-full" />
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ListSkeleton() {
  return (
    <div>
      <div className="border-b bg-background">
        <Container className="py-9">
          <Skeleton className="h-9 w-64" />
          <Skeleton className="mt-3 h-5 w-96 max-w-full" />
        </Container>
      </div>
      <Container className="pt-8">
        <ListBody />
      </Container>
    </div>
  );
}
