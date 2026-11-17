import { QueryClient, MutationCache } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, errorMessage } from "@/lib/api";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
    },
  },
  mutationCache: new MutationCache({
    onError: (err, _v, _c, mutation) => {
      if (mutation.options.meta?.silent) return;
      toast.error(errorMessage(err));
    },
  }),
});

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: { silent?: boolean };
  }
}
