import { QueryClient } from '@tanstack/react-query';

/**
 * One query cache for the process. Kept in its own module so auth can drop
 * every cached community read on sign-out/account switch — otherwise the next
 * member could render the previous account's threads from memory.
 */
export const queryClient = new QueryClient();
