import { useQuery } from "@tanstack/react-query";
import { apiGet } from "./client";
import type { Attendance, WeekGrid } from "./types";

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
