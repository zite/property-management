import { BarChart3, Lock } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { REPORT_BY_KEY } from '../components/reports/catalog';
import { ReportView } from '../components/reports/ReportFrame';
import { EmptyState } from '../components/primitives/bits';
import { PageHeader, useDocumentTitle } from '../components/shell/PageHeader';
import { useWorkspace } from '../lib/workspace';

/** One report at `/reports/:report`, its parameters in the query string. */
export function ReportPage() {
  const ws = useWorkspace();
  const { report } = useParams();
  const def = report ? REPORT_BY_KEY.get(report) : undefined;
  useDocumentTitle(def?.title ?? 'Report');

  if (!def) {
    return (
      <>
        <PageHeader icon={<BarChart3 />} breadcrumb={{ to: '/reports', label: 'Reports' }} title="Report not found" />
        <EmptyState
          className="flex-1"
          icon={<BarChart3 />}
          title="That report doesn’t exist"
          description="The link may be from an older version of this app. Pick a report from the catalog."
          action={<Link to="/reports" className="ghost-chip h-9 border-border bg-background">All reports</Link>}
        />
      </>
    );
  }
  if (def.financial && !ws.can('accounting.view')) {
    return (
      <>
        <PageHeader icon={<Lock />} breadcrumb={{ to: '/reports', label: 'Reports' }} title={def.title} />
        <EmptyState className="flex-1" icon={<Lock />} title="This report shows the books" description={`Your role (${ws.me.role}) can’t see financial reports. An admin can change your role in Settings → Team.`} action={<Link to="/reports" className="ghost-chip h-9 border-border bg-background">All reports</Link>} />
      </>
    );
  }
  return <ReportView key={def.key} def={def} />;
}
