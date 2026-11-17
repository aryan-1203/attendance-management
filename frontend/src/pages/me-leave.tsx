import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { History, ListChecks, Plus } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useCycle } from "@/lib/cycle";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { Pager } from "@/components/shared/data-table";
import { EmptyState } from "@/components/shared/empty-state";
import { ErrorState, PageHeader } from "@/components/shared/page";
import { useBalances, useLeaveRequests, useLedger, useSummary } from "@/features/leave/api";
import { ApplyLeaveDialog } from "@/features/leave/apply-leave-dialog";
import { BalanceCards } from "@/features/leave/balance-cards";
import { STATUS_FILTERS, Segmented } from "@/features/leave/segmented";
import { LedgerTable } from "@/features/leave/ledger";
import { ListSkeleton, MyLeaveList } from "@/features/me/my-requests";
import { NotLinked } from "@/features/me/not-linked";

const TABS = ["requests", "ledger"] as const;
type Tab = (typeof TABS)[number];

export default function MeLeavePage() {
  const { user } = useAuth();
  const empId = user?.employee_id ?? undefined;
  const [applyOpen, setApplyOpen] = React.useState(false);
  if (!user) return null;
  return (
    <>
      <PageHeader title="My leave"
        description="Balances, requests and every ledger entry. Leave accrues 1.5 days per cycle (20th → 19th)."
        actions={empId ? <Button onClick={() => setApplyOpen(true)}><Plus />Apply leave</Button> : undefined} />
      {!empId ? <NotLinked /> : <Body empId={empId} onApply={() => setApplyOpen(true)} />}
      <ApplyLeaveDialog open={applyOpen} onOpenChange={setApplyOpen} />
    </>
  );
}

function Body({ empId, onApply }: { empId: number; onApply: () => void }) {
  const [params, setParams] = useSearchParams();
  const tab: Tab = (TABS as readonly string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as Tab) : "requests";
  const setTab = (t: string) => setParams((p) => { const n = new URLSearchParams(p); n.set("tab", t); return n; }, { replace: true });
  const { current } = useCycle();
  const summary = useSummary(empId, current?.id);
  const balances = useBalances(empId);
  const ledger = useLedger(empId);

  return (
    <div className="grid gap-5">
      <BalanceCards balances={balances.data} onProbation={summary.data?.on_probation} loading={balances.isLoading} />
      {balances.isError && <ErrorState error={balances.error} onRetry={() => void balances.refetch()} />}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="My leave sections">
          <TabsTrigger value="requests"><ListChecks />Requests</TabsTrigger>
          <TabsTrigger value="ledger"><History />Ledger history</TabsTrigger>
        </TabsList>
        <TabsContent value="requests"><Requests onApply={onApply} /></TabsContent>
        <TabsContent value="ledger">
          {ledger.isError ? <ErrorState error={ledger.error} onRetry={() => void ledger.refetch()} /> :
            <LedgerTable entries={ledger.data} loading={ledger.isLoading} />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Requests({ onApply }: { onApply: () => void }) {
  const [status, setStatus] = React.useState<string>("");
  const [page, setPage] = React.useState(1);
  const q = useLeaveRequests({ scope: "mine", status, page, page_size: 10 });
  return (
    <div className="grid gap-3">
      <Segmented label="Filter by status" value={status} onChange={(v) => { setStatus(v); setPage(1); }}
        options={STATUS_FILTERS} />
      {q.isLoading ? <ListSkeleton rows={4} /> : q.isError ? <ErrorState error={q.error} onRetry={() => void q.refetch()} /> :
        !q.data?.items.length ? (
          <Card><CardContent className="p-2">
            <EmptyState art="calendar" title={status ? `No ${status} requests` : "No leave requests yet"}
              description="When you apply, you'll see exactly how many days are paid and whether any become loss of pay — before you send it."
              action={<Button onClick={onApply}><Plus />Apply leave</Button>} />
          </CardContent></Card>
        ) : (
          <>
            <MyLeaveList items={q.data.items} />
            {q.data.pages > 1 && <Pager page={page} pages={q.data.pages} total={q.data.total} onPage={setPage} />}
          </>
        )}
    </div>
  );
}
