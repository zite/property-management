import { Navigate, useParams } from 'react-router-dom';
import { AccountRegisterPage } from '../components/accounting/AccountRegister';
import { BankingView } from '../components/accounting/BankingView';
import { BillPage } from '../components/accounting/BillPage';
import { ChartView } from '../components/accounting/ChartView';
import { OwnersView } from '../components/accounting/OwnersView';
import { PayablesView } from '../components/accounting/PayablesView';
import { ACCOUNTING_TABS, type AccountingTab } from '../components/accounting/parts';
import { ReceivablesView } from '../components/accounting/ReceivablesView';
import { TransactionsView } from '../components/accounting/TransactionsView';

/**
 * Accounting: `/accounting/:tab` and `/accounting/:tab/:id`.
 *
 *   receivables                aging, payments register (?view=payments), deposits held (?view=deposits)
 *   payables[/:billId]         bills and bill payments (?view=payments); a bill's page
 *   banking[/:accountId]       bank accounts; an account's register, reconciliation at ?mode=reconcile
 *   owners                     owner funds, distributions, management fees
 *   transactions[/:id]         the general ledger, with a transaction open in a sheet
 *   chart[/:accountId]         chart of accounts; any account's register
 */
export function AccountingPage() {
  const { tab, id } = useParams();
  if (!ACCOUNTING_TABS.some(t => t.key === tab)) return <Navigate to="/accounting/receivables" replace />;
  switch (tab as AccountingTab) {
    case 'receivables':
      return <ReceivablesView />;
    case 'payables':
      return id ? <BillPage key={id} id={id} /> : <PayablesView />;
    case 'banking':
      return id ? <AccountRegisterPage key={id} accountId={id} from="banking" /> : <BankingView />;
    case 'owners':
      return <OwnersView />;
    case 'transactions':
      return <TransactionsView openId={id} />;
    case 'chart':
      return id ? <AccountRegisterPage key={id} accountId={id} from="chart" /> : <ChartView />;
  }
}
