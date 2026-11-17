import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { ArrowLeftRight, Banknote, ListChecks, Repeat2, SlidersHorizontal, UserPlus } from "lucide-react";
import { useAuth } from "@/lib/auth";
import type { Employee } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { PageHeader } from "@/components/shared/page";
import { AdjustmentsPanel, type Bucket } from "@/features/leave/adjustments";
import { ApplyLeaveDialog } from "@/features/leave/apply-leave-dialog";
// HR-only version: no employee-raised requests to approve. Re-enable with the approvals/corrections tabs below.
// import { ApprovalsInbox, useInbox } from "@/features/leave/approvals-inbox";
import { CompOffPanel } from "@/features/leave/comp-off-panel";
import { LeaveRequestsTable } from "@/features/leave/request-tables";
// import { RegularizationsTable } from "@/features/leave/request-tables";
import { CarryForwardPanel, EncashmentPanel } from "@/features/leave/year-end";

const ALL_TABS = [
  // HR-only version: employees don't submit requests, so the approvals & corrections inboxes are hidden.
  // { value: "approvals", label: "Approvals", icon: Inbox, hr: false },
  { value: "requests", label: "Leave records", icon: ListChecks, hr: false },
  // { value: "regularizations", label: "Corrections", icon: Wrench, hr: false },
  { value: "adjustments", label: "Adjustments", icon: SlidersHorizontal, hr: true },
  { value: "comp-off", label: "Comp-off", icon: ArrowLeftRight, hr: true },
  { value: "carry-forward", label: "Carry forward", icon: Repeat2, hr: true },
  { value: "encashment", label: "Encashment", icon: Banknote, hr: true },
] as const;

export default function LeavePage() {
  const { can } = useAuth();
  const isHR = can("hr_admin");
  const tabs = ALL_TABS.filter((t) => !t.hr || isHR);
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab = tabs.some((t) => t.value === raw) ? raw! : "requests";
  const setTab = React.useCallback((t: string) => setParams((p) => {
    const n = new URLSearchParams(p);
    n.set("tab", t);
    return n;
  }, { replace: true }), [setParams]);

  // const inbox = useInbox();
  // const pending = inbox.data?.length ?? 0;
  const [applyOpen, setApplyOpen] = React.useState(false);
  // shared between Adjustments and Comp-off so HR can hop between them for one person
  const [hrEmp, setHrEmp] = React.useState<Employee | null>(null);
  const [preset, setPreset] = React.useState<{ bucket: Bucket; n: number } | undefined>(undefined);

  return (
    <>
      <PageHeader title="Leave management"
        description="Record leave for employees, correct balances and run year-end. Deductions go usable → comp-off (if chosen) → LOP."
        actions={isHR ? <Button onClick={() => setApplyOpen(true)}><UserPlus />Record leave</Button> : undefined} />

      <Tabs value={tab} onValueChange={setTab}>
        <div className="-mx-4 overflow-x-auto px-4 pb-1 scrollbar-thin sm:mx-0 sm:px-0">
          <TabsList aria-label="Leave sections" className="w-max">
            {tabs.map((t) => {
              const Icon = t.icon;
              return (
                <TabsTrigger key={t.value} value={t.value}>
                  <Icon />{t.label}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>
        {/* <TabsContent value="approvals"><ApprovalsInbox /></TabsContent> */}
        <TabsContent value="requests"><LeaveRequestsTable /></TabsContent>
        {/* <TabsContent value="regularizations"><RegularizationsTable /></TabsContent> */}
        {isHR && <>
          <TabsContent value="adjustments">
            <AdjustmentsPanel employee={hrEmp} onEmployee={setHrEmp} preset={preset} />
          </TabsContent>
          <TabsContent value="comp-off">
            <CompOffPanel employee={hrEmp} onEmployee={setHrEmp}
              onGrant={() => { setPreset((p) => ({ bucket: "comp_off", n: (p?.n ?? 0) + 1 })); setTab("adjustments"); }} />
          </TabsContent>
          <TabsContent value="carry-forward"><CarryForwardPanel /></TabsContent>
          <TabsContent value="encashment"><EncashmentPanel /></TabsContent>
        </>}
      </Tabs>

      {isHR && <ApplyLeaveDialog open={applyOpen} onOpenChange={setApplyOpen} onBehalf allowAutoApprove />}
    </>
  );
}
