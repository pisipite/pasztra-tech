export declare function fahrenheitToCelsius(value: number): number;
export declare function normalizeGoveeTemperature(value: number, declaredUnit?: string): number;
export declare function repairClimateHistory<T extends { temperature: number }>(samples: T[]): T[];
