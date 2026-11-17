import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { useMutation } from "@tanstack/react-query";
import { client, unwrap } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export const passwordSchema = z.string()
  .min(8, "At least 8 characters")
  .regex(/[A-Z]/, "Add an uppercase letter")
  .regex(/[a-z]/, "Add a lowercase letter")
  .regex(/\d/, "Add a number")
  .regex(/[^A-Za-z0-9]/, "Add a symbol");

const schema = z.object({ current: z.string().min(1, "Required"), next: passwordSchema, confirm: z.string() })
  .refine((v) => v.next === v.confirm, { path: ["confirm"], message: "Passwords don't match" });

export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { logout } = useAuth();
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), mode: "onTouched" });
  const m = useMutation({
    mutationFn: (v: z.infer<typeof schema>) =>
      unwrap(client.POST("/api/auth/change-password", { body: { current_password: v.current, new_password: v.next } })),
    onSuccess: () => { toast.success("Password changed. Please sign in again."); onOpenChange(false); logout(); },
  });
  const e = form.formState.errors;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Change password</DialogTitle>
          <DialogDescription>You'll be signed out of all sessions afterwards.</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={form.handleSubmit((v) => m.mutate(v))} noValidate>
          <Field label="Current password" htmlFor="cp-current" error={e.current?.message}>
            <Input id="cp-current" type="password" autoComplete="current-password" aria-invalid={!!e.current} {...form.register("current")} />
          </Field>
          <Field label="New password" htmlFor="cp-next" error={e.next?.message} hint="8+ characters with upper, lower, number & symbol">
            <Input id="cp-next" type="password" autoComplete="new-password" aria-invalid={!!e.next} {...form.register("next")} />
          </Field>
          <Field label="Confirm new password" htmlFor="cp-confirm" error={e.confirm?.message}>
            <Input id="cp-confirm" type="password" autoComplete="new-password" aria-invalid={!!e.confirm} {...form.register("confirm")} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" loading={m.isPending}>Update password</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
