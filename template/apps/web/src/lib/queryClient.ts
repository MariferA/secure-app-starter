import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';
import { clearPrivateState, endLocalSession } from '../features/auth/sessionState';

export const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.code === 'account_not_allowed')
      )
        endLocalSession(queryClient);
    },
    onSuccess: (data, query) => {
      if (
        query.queryKey[0] === 'auth' &&
        query.queryKey[1] === 'session' &&
        !(data as { authenticated: boolean }).authenticated
      )
        clearPrivateState(queryClient);
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      if (
        error instanceof ApiError &&
        (error.status === 401 || error.code === 'account_not_allowed')
      )
        endLocalSession(queryClient);
    },
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: (failures, error) =>
        !(error instanceof ApiError && error.status < 500) && failures < 1,
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});
