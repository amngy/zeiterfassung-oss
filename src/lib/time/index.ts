// Public surface of the pure time-calculation module. Import from "@/lib/time".
// Everything re-exported here is framework- and database-independent.

export * from "./types";
export * from "./tz";
export * from "./duration";
export * from "./schedule";
export * from "./vacation";
export * from "./absence";
export * from "./absence-kinds";
export * from "./day";
export * from "./format";
export * from "./compliance";
export * from "./shifts";

// Selective, because `requiredBreakMinutes` lives here but is re-exported by
// ./compliance, which has always been its published home.
export {
  autoBreakDeductionMs,
  closeUnfinishedBreaks,
  resolveAutoBreak,
  type AutoBreakPolicy,
  type AutoBreakSource,
  type BreakThresholds,
} from "./breaks";

// Live-status helper for the "today" card (clocked in / on break / idle).
export {
  liveStatus,
  type LiveState,
  type LiveStatus,
} from "./live";
