import { shareGlobal } from '../core/pageContext';
import { log } from '../utils/logger';
import type { WeatherType } from '../features/mutations/reminder';
import { isDebugGlobalsEnabled } from '../utils/debugGlobals';

export type MutationActiveWeather = Exclude<WeatherType, 'sunny' | 'unknown'>;

export interface MutationWeatherSummary {
	weather: MutationActiveWeather;
	plantCount: number;
	pendingFruitCount: number;
	needsSnowFruitCount?: number;
}

export interface MutationWeatherWindow {
	weather: WeatherType;
	startedAt: number | null;
	expectedEndAt: number | null;
	durationMs: number | null;
	remainingMs: number | null;
}

export interface MutationLunarStats {
	trackedPlantCount: number;
	pendingPlantCount: number;
	mutatedPlantCount: number;
	totalFruitCount: number;
	pendingFruitCount: number;
	mutatedFruitCount: number;
}

export interface MutationSummary {
	timestamp: number;
	activeWeather: WeatherType;
	totals: Record<MutationActiveWeather, MutationWeatherSummary>;
	overallEligiblePlantCount: number;
	overallPendingFruitCount: number;
	overallTrackedPlantCount: number;
	lunar: MutationLunarStats;
	weatherWindow: MutationWeatherWindow | null;
}

export type MutationSummarySource = 'inventory' | 'garden';

export interface MutationSummaryEnvelope {
	source: MutationSummarySource;
	summary: MutationSummary;
}

export type MutationDebugPlantSource = 'inventory' | 'garden' | 'fallback';

export interface MutationDebugWeatherEntry {
	name: string;
	pendingFruit: number;
	needsSnowFruit: number;
	fruitCount: number;
	source: MutationDebugPlantSource;
	tag?: string;
}

export type MutationDebugWeatherMap = Record<MutationActiveWeather, MutationDebugWeatherEntry[]>;

export interface MutationDebugSnapshot {
	source: MutationSummarySource;
	generatedAt: number;
	summary: MutationSummary;
	perWeather: MutationDebugWeatherMap;
	metadata?: {
		scannedPlantCount?: number;
		highlightedPlantCount?: number;
		lunarTrackedPlantCount?: number;
		lunarPendingPlantCount?: number;
		lunarMutatedPlantCount?: number;
		nonLunarMutatedPlantCount?: number;
		dawnPendingFruitCount?: number;
		amberPendingFruitCount?: number;
		notes?: string;
	};
}

export type MutationDebugMetadata = NonNullable<MutationDebugSnapshot['metadata']>;

type MutationSummaryListener = (envelope: MutationSummaryEnvelope) => void;

const listeners = new Set<MutationSummaryListener>();
const lastSummaries: Partial<Record<MutationSummarySource, MutationSummary>> = {};
const debugSnapshots: Partial<Record<MutationSummarySource, MutationDebugSnapshot>> = {};

export function createEmptyMutationDebugMap(): MutationDebugWeatherMap {
	return {
		rain: [],
		snow: [],
		dawn: [],
		amber: [],
	};
}

function cloneWeatherEntries(entries: MutationDebugWeatherEntry[]): MutationDebugWeatherEntry[] {
	return entries.map((entry) => ({ ...entry }));
}

function cloneDebugSnapshot(snapshot: MutationDebugSnapshot): MutationDebugSnapshot {
	const cloned: MutationDebugSnapshot = {
		source: snapshot.source,
		generatedAt: snapshot.generatedAt,
		summary: snapshot.summary,
		perWeather: {
			rain: cloneWeatherEntries(snapshot.perWeather.rain ?? []),
			snow: cloneWeatherEntries(snapshot.perWeather.snow ?? []),
			dawn: cloneWeatherEntries(snapshot.perWeather.dawn ?? []),
			amber: cloneWeatherEntries(snapshot.perWeather.amber ?? []),
		},
	};
	if (snapshot.metadata) {
		cloned.metadata = { ...snapshot.metadata };
	}
	return cloned;
}

export function updateMutationDebugSnapshot(snapshot: MutationDebugSnapshot): void {
	const stored: MutationDebugSnapshot = {
		...snapshot,
		perWeather: {
			rain: cloneWeatherEntries(snapshot.perWeather.rain ?? []),
			snow: cloneWeatherEntries(snapshot.perWeather.snow ?? []),
			dawn: cloneWeatherEntries(snapshot.perWeather.dawn ?? []),
			amber: cloneWeatherEntries(snapshot.perWeather.amber ?? []),
		},
	};
	if (snapshot.metadata) {
		stored.metadata = { ...snapshot.metadata };
	}
	debugSnapshots[snapshot.source] = stored;
}

export function createMutationDebugMetadata(
	summary: MutationSummary,
	extra: Partial<MutationDebugMetadata> = {},
): MutationDebugMetadata {
	const overallMutatedPlantCount = Math.max(
		0,
		summary.overallTrackedPlantCount - summary.overallEligiblePlantCount,
	);
	const nonLunarMutatedPlantCount = Math.max(
		0,
		overallMutatedPlantCount - summary.lunar.mutatedPlantCount,
	);

	return {
		...extra,
		lunarTrackedPlantCount: summary.lunar.trackedPlantCount,
		lunarPendingPlantCount: summary.lunar.pendingPlantCount,
		lunarMutatedPlantCount: summary.lunar.mutatedPlantCount,
		nonLunarMutatedPlantCount,
		dawnPendingFruitCount: summary.totals.dawn.pendingFruitCount,
		amberPendingFruitCount: summary.totals.amber.pendingFruitCount,
	};
}

function getDebugSnapshotRef(source?: MutationSummarySource): MutationDebugSnapshot | null {
	if (source) {
		return debugSnapshots[source] ?? null;
	}
	return debugSnapshots.garden ?? debugSnapshots.inventory ?? null;
}

function exportDebugSnapshot(source?: MutationSummarySource): MutationDebugSnapshot | null {
	const snapshot = getDebugSnapshotRef(source);
	if (!snapshot) {
		return null;
	}
	return cloneDebugSnapshot(snapshot);
}

function listPlantsForSnapshot(snapshot: MutationDebugSnapshot) {
	return {
		source: snapshot.source,
		generatedAt: snapshot.generatedAt,
		activeWeather: snapshot.summary.activeWeather,
		perWeather: {
			rain: snapshot.perWeather.rain.map((entry) => entry.name),
			snow: snapshot.perWeather.snow.map((entry) => entry.name),
			dawn: snapshot.perWeather.dawn.map((entry) => entry.name),
			amber: snapshot.perWeather.amber.map((entry) => entry.name),
		},
		metadata: snapshot.metadata ? { ...snapshot.metadata } : undefined,
	};
}

const mutationDebugApi = {
	get(source?: MutationSummarySource) {
		return exportDebugSnapshot(source);
	},
	getAll() {
		const result: Partial<Record<MutationSummarySource, MutationDebugSnapshot>> = {};
		(Object.keys(debugSnapshots) as MutationSummarySource[]).forEach((key) => {
			const snapshot = debugSnapshots[key];
			if (snapshot) {
				result[key] = cloneDebugSnapshot(snapshot);
			}
		});
		return result;
	},
	list(source?: MutationSummarySource) {
		const snapshot = getDebugSnapshotRef(source);
		if (!snapshot) {
			return null;
		}
		return listPlantsForSnapshot(snapshot);
	},
	print(source?: MutationSummarySource) {
		const snapshot = getDebugSnapshotRef(source);
		if (!snapshot) {
			return null;
		}
		const rows: Array<{ weather: MutationActiveWeather; name: string; pending: number; needsSnow: number; fruit: number; source: MutationDebugPlantSource; tag?: string }> = [];
		(['rain', 'snow', 'dawn', 'amber'] as MutationActiveWeather[]).forEach((weather) => {
			const entries = snapshot.perWeather[weather] ?? [];
			entries.forEach((entry) => {
								const row: { weather: MutationActiveWeather; name: string; pending: number; needsSnow: number; fruit: number; source: MutationDebugPlantSource; tag?: string } = {
					weather,
					name: entry.name,
					pending: entry.pendingFruit,
					needsSnow: entry.needsSnowFruit,
					fruit: entry.fruitCount,
					source: entry.source,
								};
								if (entry.tag) {
									row.tag = entry.tag;
								}
								rows.push(row);
			});
		});
			const logger = globalThis.console;
			if (rows.length === 0) {
				logger?.info?.('[QPM] No mutation plants recorded for current snapshot.');
				return [];
			}
			if (logger?.table) {
				logger.table(rows);
			} else {
				logger?.log?.(rows);
			}
		return rows;
	},
};

if (isDebugGlobalsEnabled()) {
	shareGlobal('__qpmMutationDebug', mutationDebugApi);
}

export function publishMutationSummary(source: MutationSummarySource, summary: MutationSummary): void {
	lastSummaries[source] = summary;
	const envelope: MutationSummaryEnvelope = { source, summary };
	for (const listener of listeners) {
		try {
			listener(envelope);
		} catch (error) {
			log('⚠️ Mutation summary listener error', error);
		}
	}
}

export function getMutationSummary(source?: MutationSummarySource): MutationSummary | null {
	if (source) {
		return lastSummaries[source] ?? null;
	}
	return lastSummaries.inventory ?? lastSummaries.garden ?? null;
}

export function getAllMutationSummaries(): Partial<Record<MutationSummarySource, MutationSummary>> {
	return { ...lastSummaries };
}

export function onMutationSummary(cb: MutationSummaryListener, fireImmediately = true): () => void {
	listeners.add(cb);
	if (fireImmediately) {
		const sources = Object.keys(lastSummaries) as MutationSummarySource[];
		for (const source of sources) {
			const summary = lastSummaries[source];
			if (!summary) continue;
			try {
				cb({ source, summary });
			} catch (error) {
				log('⚠️ Mutation summary immediate listener error', error);
			}
		}
	}
	return () => {
		listeners.delete(cb);
	};
}
