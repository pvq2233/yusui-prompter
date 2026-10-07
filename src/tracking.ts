import options from '../tracking-options.json';

export const TRACKING_OPTIONS = options;
export type TrackingKey = keyof typeof options;
export type TrackingSettings = Record<TrackingKey, number>;
export const TRACKING_KEYS = Object.keys(options) as TrackingKey[];
export const DEFAULT_TRACKING = Object.fromEntries(TRACKING_KEYS.map(key => [key, options[key].default])) as TrackingSettings;

// Older or malformed local preferences fall back per field, never to arbitrary values.
export function readTracking(value: unknown): TrackingSettings {
  const stored = value && typeof value === 'object' ? value as Partial<TrackingSettings> : {};
  return Object.fromEntries(TRACKING_KEYS.map(key => [key,
    options[key].choices.some(choice => choice.value === stored[key]) ? stored[key] : options[key].default,
  ])) as TrackingSettings;
}
