import type { AppState } from '../model/controller';
import type { DispatchRecord } from '../model/actions';
import type { UiState } from '../model/uiState';

/** What the lab's timeline records about one device's traffic. */
export type NetworkRecord = { device: string; method?: string; path?: string; status?: number; error?: string; data?: string };

/** What a screen did: its state changed, its drafts changed, or an action ran. */
export type AppRecord = { device: string; kind: string; detail: AppState | UiState | DispatchRecord };

export type PageError = { device: string; error: string };

/** One entry for the supervisor's timeline, named by the kind of record. */
export type LabEvent = { name: string; detail: NetworkRecord | AppRecord | PageError };

export type LabReport = (event: LabEvent) => void;
