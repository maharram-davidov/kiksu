import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiPost } from "./client";
import type { Comment, PostDetail } from "./types";

/**
 * Optimistic vote.
 *
 * A vote is the cheapest possible interaction and the one most likely to
 * happen on bad campus wifi, so the arrow flips immediately and rolls back if
 * the server disagrees. The rollback matters: silently keeping a vote the
 * server rejected would show a student a score that does not exist.
 */
export function useVotePost(postId: string) {
  const qc = useQueryClient();
  const key = ["forum", "post", postId];

  return useMutation({
    mutationFn: (value: -1 | 0 | 1) =>
      apiPost<{ score: number; your_vote: -1 | 0 | 1 }>(`/forum/posts/${postId}/vote`, { value }),
    onMutate: async (value) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<PostDetail>(key);
      if (previous) {
        // The server owns the real arithmetic; this is a local guess that
        // assumes no prior vote, which is the common case.
        qc.setQueryData<PostDetail>(key, { ...previous, score: previous.score + value });
      }
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
}

export function useSavePost(postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (saved: boolean) =>
      apiPost<{ saved: boolean; save_count: number }>(`/forum/posts/${postId}/save`, { saved }),
    onSettled: () => qc.invalidateQueries({ queryKey: ["forum", "post", postId] }),
  });
}

/**
 * Posts a comment.
 *
 * Deliberately NOT optimistic. The alias is assigned by the server inside the
 * same transaction as the insert, so an optimistic comment would have to guess
 * its own "Anonim N" — and showing the wrong ordinal, even for a second, would
 * undermine the one thing the numbering exists to make trustworthy.
 */
export function useCreateComment(postId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      apiPost<Comment>(`/forum/posts/${postId}/comments`, { body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["forum", "post", postId] }),
  });
}
