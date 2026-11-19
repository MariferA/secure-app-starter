import { create } from 'zustand';
// UI state only. The browser manages the HttpOnly session cookie.
export const useAuthStore = create<{
  isSessionLocked: boolean;
  setSessionLocked: (locked: boolean) => void;
  resetUi: () => void;
}>((set) => ({
  isSessionLocked: false,
  setSessionLocked: (isSessionLocked) => set({ isSessionLocked }),
  resetUi: () => set({ isSessionLocked: false }),
}));
