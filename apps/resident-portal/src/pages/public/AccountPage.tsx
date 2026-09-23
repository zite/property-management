import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ClipboardList, LogOut, Mail, Phone, Search, UserRound } from 'lucide-react';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { getAccountProfile, updateAccountProfile, type GetAccountProfileOutputType } from 'zitejs/api';
import { formatPhone } from '../../components/apply/fields';
import { areasFor } from '../../components/Layout';
import { SignInPrompt } from '../../components/SignInPrompt';
import { Alert, Button, Card, Container, Skeleton, inputClass } from '../../components/ui';
import { useSession } from '../../lib/auth';
import { errorMessage } from '../../lib/errors';
import { initials, plural } from '../../lib/format';
import { qk, retry, useMe } from '../../lib/queries';
import { useDocumentTitle } from '../../lib/useDocumentTitle';

const profileKey = ['portal', 'applications', 'account'] as const;

/** Who you're signed in as, which portals that email opens, and the phone number the office has for you. */
export default function AccountPage() {
  useDocumentTitle('Account');
  const { user, isLoading, signOut } = useSession();
  const me = useMe();
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: profileKey, queryFn: () => getAccountProfile({}), enabled: Boolean(user), staleTime: 30_000, retry });

  if (isLoading) return <AccountSkeleton />;
  if (!user) return <SignInPrompt title="Sign in to your account" body="Sign in with your email to see your portals and contact details." hashPath="/account" />;

  const areas = areasFor(me.data);
  const name = profile.data?.name || me.data?.name || user.email || '';
  const doSignOut = () => {
    qc.removeQueries({ queryKey: ['portal'], predicate: q => q.queryKey[1] !== 'site' });
    signOut();
  };

  return (
    <div className="pb-12">
      <div className="border-b bg-background">
        <Container size="narrow" className="py-7 sm:py-9">
          <div className="flex items-center gap-4">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border bg-muted text-lg font-semibold text-foreground/75" aria-hidden>
              {initials(name)}
            </span>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight sm:text-3xl">{profile.isPending && me.isPending ? <span className="skeleton inline-block h-8 w-48 align-middle" aria-hidden /> : name}</h1>
              <p className="truncate text-[15px] text-muted-foreground">{user.email}</p>
            </div>
          </div>
        </Container>
      </div>

      <Container size="narrow" className="space-y-6 pt-6 sm:pt-8">
        <Card as="section" className="p-5 sm:p-6" aria-labelledby="portals-heading">
          <h2 id="portals-heading" className="text-lg font-semibold tracking-tight">
            Your portals
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">What {user.email} can open here.</p>
          {me.isPending ? (
            <div className="mt-4 space-y-2">
              <Skeleton className="h-14 rounded-lg" />
              <Skeleton className="h-14 rounded-lg" />
            </div>
          ) : me.isError ? (
            <Alert tone="danger" className="mt-4" action={<Button variant="secondary" size="sm" onClick={() => me.refetch()}>Try again</Button>}>
              {errorMessage(me.error, 'Your portals didn’t load.')}
            </Alert>
          ) : (
            <ul className="mt-4 divide-y rounded-xl border">
              {areas.map(a => (
                <PortalRow key={a.area} to={a.to} icon={<a.icon className="h-5 w-5" aria-hidden />} title={a.label} hint={a.hint} />
              ))}
              {(me.data?.applicant.applications ?? 0) > 0 && (
                <PortalRow to="/applications" icon={<ClipboardList className="h-5 w-5" aria-hidden />} title="My applications" hint={plural(me.data!.applicant.applications, 'application')} />
              )}
              <PortalRow to="/homes" icon={<Search className="h-5 w-5" aria-hidden />} title="Homes for rent" hint="Browse and apply" />
            </ul>
          )}
          {!me.isPending && areas.length === 0 && (
            <p className="mt-4 text-sm text-muted-foreground">
              Live in one of our homes, own a property we manage, or work with us as a vendor? Ask the office to add <span className="font-medium text-foreground">{user.email}</span> and your portal will appear here.
            </p>
          )}
        </Card>

        <Card as="section" className="p-5 sm:p-6" aria-labelledby="contact-heading">
          <h2 id="contact-heading" className="text-lg font-semibold tracking-tight">
            Contact details
          </h2>
          <dl className="mt-4 divide-y rounded-xl border">
            <Row icon={<UserRound className="h-4 w-4" aria-hidden />} label="Name">
              {name}
            </Row>
            <Row icon={<Mail className="h-4 w-4" aria-hidden />} label="Email">
              {user.email}
            </Row>
          </dl>
          <p className="mt-2 text-sm text-muted-foreground">Your name and email come from how you sign in. To use a different email, ask the office to update it on your record.</p>

          <div className="mt-6 border-t pt-6">
            {profile.isPending ? (
              <Skeleton className="h-20 rounded-lg" />
            ) : profile.isError ? (
              <Alert tone="danger" action={<Button variant="secondary" size="sm" onClick={() => profile.refetch()}>Try again</Button>}>
                {errorMessage(profile.error, 'Your contact details didn’t load.')}
              </Alert>
            ) : profile.data?.resident ? (
              <PhoneForm profile={profile.data} />
            ) : (
              <p className="flex items-start gap-2.5 text-[15px] text-muted-foreground">
                <Phone className="mt-1 h-4 w-4 shrink-0" aria-hidden />
                <span>Applying for a home? The phone number on each application is the one the leasing team will use.</span>
              </p>
            )}
          </div>
        </Card>

        <Card as="section" className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">Sign out</h2>
            <p className="text-sm text-muted-foreground">You’ll need your email to sign back in.</p>
          </div>
          <Button variant="secondary" onClick={doSignOut}>
            <LogOut aria-hidden /> Sign out
          </Button>
        </Card>
      </Container>
    </div>
  );
}

function PortalRow({ to, icon, title, hint }: { to: string; icon: ReactNode; title: string; hint?: string }) {
  return (
    <li>
      <Link to={to} className="group flex items-center gap-3 px-4 py-3 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/35">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-background text-muted-foreground">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium">{title}</span>
          {hint && <span className="block truncate text-sm text-muted-foreground">{hint}</span>}
        </span>
        <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </li>
  );
}

function Row({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <dt className="flex w-24 shrink-0 items-center gap-2 text-[15px] text-muted-foreground">
        {icon} {label}
      </dt>
      <dd className="min-w-0 flex-1 truncate text-[15px]">{children}</dd>
    </div>
  );
}

function PhoneForm({ profile }: { profile: GetAccountProfileOutputType }) {
  const qc = useQueryClient();
  const id = useId();
  const saved = profile.resident?.phone ?? '';
  const [phone, setPhone] = useState(saved);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => setPhone(saved), [saved]);

  const save = useMutation({
    mutationFn: (value: string) => updateAccountProfile({ phone: value }),
    onSuccess: res => {
      qc.setQueryData<GetAccountProfileOutputType>(profileKey, prev => (prev?.resident ? { ...prev, resident: { ...prev.resident, phone: res.phone } } : prev));
      void qc.invalidateQueries({ queryKey: qk.resident });
      setPhone(res.phone);
      toast.success('Phone number updated.');
    },
    onError: e => setProblem(errorMessage(e, 'Your phone number wasn’t saved. Try again.')),
  });

  const dirty = phone.trim() !== saved;
  const submit = () => {
    const value = formatPhone(phone);
    const digits = value.replace(/\D/g, '');
    if (!value) return setProblem('Enter a phone number so the office and maintenance can reach you.');
    if (digits.length < 10 || digits.length > 15) return setProblem('Enter a phone number with area code, like (303) 555-0142.');
    setProblem(null);
    setPhone(value);
    save.mutate(value);
  };

  return (
    <form
      noValidate
      onSubmit={e => {
        e.preventDefault();
        if (dirty && !save.isPending) submit();
      }}
    >
      <label htmlFor={id} className="block text-[15px] font-medium">
        Phone number
      </label>
      <p id={`${id}-hint`} className="mt-0.5 text-sm text-muted-foreground">
        The number on your resident record — the office and maintenance use it to reach you.
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phone}
          maxLength={40}
          onChange={e => {
            setPhone(e.target.value);
            if (problem) setProblem(null);
          }}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${id}-error` : `${id}-hint`}
          className={inputClass('sm:max-w-xs')}
        />
        <Button type="submit" variant={dirty ? 'primary' : 'secondary'} disabled={!dirty} loading={save.isPending} className="h-11">
          Save
        </Button>
      </div>
      {problem && (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-sm text-tone-danger">
          {problem}
        </p>
      )}
    </form>
  );
}

function AccountSkeleton() {
  return (
    <div role="status" aria-label="Loading">
      <div className="border-b bg-background">
        <Container size="narrow" className="flex items-center gap-4 py-9">
          <Skeleton className="h-14 w-14 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-56" />
          </div>
        </Container>
      </div>
      <Container size="narrow" className="space-y-6 pt-8">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </Container>
    </div>
  );
}
