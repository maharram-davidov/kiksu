import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./client";
import type { Attendance, Board, PostDetail, PostPage, WeekGrid } from "./types";

export function useWeekGrid() {
  return useQuery({
    queryKey: ["timetable", "week"],
    queryFn: () => apiGet<WeekGrid>("/timetable/week"),
    // A timetable changes at most a few times a semester; refetching it on
    // every focus would burn campus wifi for nothing.
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useAttendance() {
  return useQuery({
    queryKey: ["timetable", "attendance"],
    queryFn: () => apiGet<Attendance[]>("/timetable/attendance"),
    staleTime: 60 * 1000,
    retry: 1,
  });
}

export function useBoards() {
  return useQuery({
    queryKey: ["forum", "boards"],
    queryFn: () => apiGet<Board[]>("/forum/boards"),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
}

export function useBoardFeed(slug: string) {
  return useQuery({
    queryKey: ["forum", "board", slug],
    queryFn: () => apiGet<PostPage>(`/forum/boards/${encodeURIComponent(slug)}/posts`),
    // Feeds move; 30s keeps a back-navigation instant without serving
    // yesterday's board.
    staleTime: 30 * 1000,
    retry: 1,
  });
}

export function usePost(id: string) {
  return useQuery({
    queryKey: ["forum", "post", id],
    queryFn: () => apiGet<PostDetail>(`/forum/posts/${encodeURIComponent(id)}`),
    staleTime: 30 * 1000,
    retry: 1,
  });
}
