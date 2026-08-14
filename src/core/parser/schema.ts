import type {
  CombatEvent,
  CombatLogOrigin,
  CombatLogVersion,
  EventFamily,
  EventPayload,
  OperationResult,
  RawCombatLogRecord,
  SchemaSelection,
  SpellReference,
} from "../contracts";

import { actorReference } from "./actors";
import { parserFailure, parserWarning } from "./diagnostics";

export interface BuildRange {
  readonly minimum: string;
  readonly maximum: string;
}

export interface CombatLogSchemaCompatibility {
  readonly projectId: number;
  readonly logVersions: readonly number[];
  readonly buildRange: BuildRange;
}

export interface CombatLogEventDefinition {
  readonly eventType: string;
  readonly family: EventFamily;
  /** Minimum payload fields after the event name. Extra fields are always retained. */
  readonly minimumFields: number;
  readonly stableFieldCount: number;
}

export interface CombatLogSchema {
  readonly id: string;
  readonly compatibility: CombatLogSchemaCompatibility;
  readonly eventDefinitions: ReadonlyMap<string, CombatLogEventDefinition>;
  readonly discoveryBoundaries: CombatLogDiscoveryBoundaries;
  normalize(
    record: RawCombatLogRecord,
    context: SchemaNormalizationContext,
  ): OperationResult<CombatEvent>;
}

export interface CombatLogDiscoveryBoundaries {
  readonly encounterStartEventTypes: readonly string[];
  readonly encounterEndEventTypes: readonly string[];
  readonly hardBoundaryEventTypes: readonly string[];
  readonly targetEndEventTypes: readonly string[];
}

export interface SchemaNormalizationContext {
  readonly parserVersion: string;
  readonly firstTimestampTicks: bigint;
  readonly origin: CombatLogOrigin;
}

export interface SelectedSchema {
  readonly schema: CombatLogSchema;
  readonly selection: SchemaSelection;
}

export interface SchemaSelectionOptions {
  readonly manualSchemaId?: string;
}

function versionParts(version: string): readonly number[] {
  return version.split(".").map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(left: string, right: string): number {
  const leftParts = versionParts(left);
  const rightParts = versionParts(right);
  const count = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < count; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function supportsExactVersion(
  schema: CombatLogSchema,
  version: CombatLogVersion,
): boolean {
  const compatibility = schema.compatibility;
  return (
    compatibility.projectId === version.projectId &&
    compatibility.logVersions.includes(version.logVersion) &&
    compareVersions(version.buildVersion, compatibility.buildRange.minimum) >=
      0 &&
    compareVersions(version.buildVersion, compatibility.buildRange.maximum) <= 0
  );
}

export class CombatLogSchemaRegistry {
  readonly #schemas = new Map<string, CombatLogSchema>();

  constructor(schemas: readonly CombatLogSchema[] = []) {
    for (const schema of schemas) this.register(schema);
  }

  register(schema: CombatLogSchema): void {
    if (this.#schemas.has(schema.id)) {
      throw new Error(
        `Combat-log schema '${schema.id}' is already registered.`,
      );
    }
    this.#schemas.set(schema.id, schema);
  }

  get(id: string): CombatLogSchema | undefined {
    return this.#schemas.get(id);
  }

  list(): readonly CombatLogSchema[] {
    return [...this.#schemas.values()];
  }

  select(
    version: CombatLogVersion,
    options: SchemaSelectionOptions = {},
  ): OperationResult<SelectedSchema> {
    if (options.manualSchemaId !== undefined) {
      const manual = this.#schemas.get(options.manualSchemaId);
      if (manual === undefined) {
        return {
          ok: false,
          error: parserFailure(
            "UNKNOWN_SCHEMA_OVERRIDE",
            "The requested combat-log schema is not installed.",
            undefined,
            undefined,
            { schemaId: options.manualSchemaId },
          ),
          warnings: [],
        };
      }
      return {
        ok: true,
        value: { schema: manual, selection: "manual-override" },
        warnings: [],
      };
    }

    const exact = this.list()
      .filter((schema) => supportsExactVersion(schema, version))
      .sort((left, right) =>
        compareVersions(
          right.compatibility.buildRange.maximum,
          left.compatibility.buildRange.maximum,
        ),
      )[0];
    if (exact !== undefined) {
      return {
        ok: true,
        value: { schema: exact, selection: "exact" },
        warnings: [],
      };
    }

    const fallback = this.list()
      .filter((schema) => schema.compatibility.projectId === version.projectId)
      .sort((left, right) =>
        compareVersions(
          right.compatibility.buildRange.maximum,
          left.compatibility.buildRange.maximum,
        ),
      )[0];
    if (fallback === undefined) {
      return {
        ok: false,
        error: parserFailure(
          "NO_COMPATIBLE_SCHEMA",
          "No installed parser schema supports this World of Warcraft project.",
          undefined,
          undefined,
          { projectId: version.projectId },
        ),
        warnings: [],
      };
    }

    return {
      ok: true,
      value: { schema: fallback, selection: "fallback" },
      warnings: [
        parserWarning(
          "SCHEMA_FALLBACK",
          `This log does not exactly match an installed schema; '${fallback.id}' was selected as the latest schema for project ${String(version.projectId)}.`,
          {
            schemaId: fallback.id,
            details: {
              detectedLogVersion: version.logVersion,
              detectedBuildVersion: version.buildVersion,
            },
          },
        ),
      ],
    };
  }
}

function fieldValues(record: RawCombatLogRecord): readonly string[] {
  return record.fields.slice(1).map((field) => field.value);
}

function optionalNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.length === 0 || value === "nil")
    return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function commonActors(values: readonly string[]) {
  const source = actorReference(
    values[0] ?? "",
    values[1],
    values[2],
    values[3],
  );
  const destination = actorReference(
    values[4] ?? "",
    values[5],
    values[6],
    values[7],
  );
  return { source, destination };
}

function spellReference(
  values: readonly string[],
  offset: number,
): SpellReference {
  const id = optionalNumber(values[offset]);
  return {
    ...(id === undefined ? {} : { id }),
    ...(values[offset + 1] === undefined ? {} : { name: values[offset + 1] }),
    ...(values[offset + 2] === undefined ? {} : { school: values[offset + 2] }),
  };
}

function eventPayload(
  definition: CombatLogEventDefinition,
  values: readonly string[],
): EventPayload {
  switch (definition.family) {
    case "cast":
      return {
        family: "cast",
        ...(definition.eventType === "SPELL_CAST_FAILED" &&
        values[11] !== undefined
          ? { failureReason: values[11] }
          : {}),
      };
    case "aura":
      return {
        family: "aura",
        ...(values[11] === undefined ? {} : { auraType: values[11] }),
        ...(values[12] === undefined ? {} : { amount: values[12] }),
      };
    case "resource":
      return { family: "resource" };
    case "combatant-info":
      return {
        family: "combatant-info",
        ...(values[0] === undefined ? {} : { combatantGuid: values[0] }),
      };
    case "encounter": {
      const encounterId = optionalNumber(values[0]);
      return {
        family: "encounter",
        ...(encounterId === undefined ? {} : { encounterId }),
        ...(values[1] === undefined ? {} : { encounterName: values[1] }),
        ...(definition.eventType === "ENCOUNTER_END"
          ? { success: values[4] === "1" }
          : {}),
      };
    }
    default:
      return { family: definition.family };
  }
}

function normalizeKnownEvent(
  schemaId: string,
  definitions: ReadonlyMap<string, CombatLogEventDefinition>,
  record: RawCombatLogRecord,
  context: SchemaNormalizationContext,
): OperationResult<CombatEvent> {
  const definition = definitions.get(record.eventType);
  const values = fieldValues(record);
  if (definition === undefined) {
    return {
      ok: true,
      value: {
        timestamp: record.timestamp,
        relativeTimeTicks:
          record.timestamp.localTimeTicks - context.firstTimestampTicks,
        type: record.eventType,
        family: "generic",
        normalized: false,
        payload: { family: "generic" },
        rawFields: record.fields,
        additionalFields: values,
        origin: context.origin,
        parserVersion: context.parserVersion,
        schemaId,
        raw: record.raw,
        location: record.location,
      },
      warnings: [
        parserWarning(
          "UNKNOWN_EVENT_TYPE",
          `The event '${record.eventType}' is not defined by schema '${schemaId}' and was retained as a generic record.`,
          {
            location: record.location,
            eventType: record.eventType,
            schemaId,
            rawLine: record.raw,
          },
        ),
      ],
    };
  }

  if (values.length < definition.minimumFields) {
    return {
      ok: true,
      value: {
        timestamp: record.timestamp,
        relativeTimeTicks:
          record.timestamp.localTimeTicks - context.firstTimestampTicks,
        type: record.eventType,
        family: "generic",
        normalized: false,
        payload: { family: "generic" },
        rawFields: record.fields,
        additionalFields: values,
        origin: context.origin,
        parserVersion: context.parserVersion,
        schemaId,
        raw: record.raw,
        location: record.location,
      },
      warnings: [
        parserWarning(
          "UNEXPECTED_FIELD_COUNT",
          `The event '${record.eventType}' has ${String(values.length)} fields; schema '${schemaId}' requires at least ${String(definition.minimumFields)}. The raw record was retained.`,
          {
            location: record.location,
            eventType: record.eventType,
            schemaId,
            rawLine: record.raw,
            details: {
              actual: values.length,
              minimum: definition.minimumFields,
            },
          },
        ),
      ],
    };
  }

  const hasCommonActors = !["combatant-info", "encounter", "version"].includes(
    definition.family,
  );
  const actors = hasCommonActors ? commonActors(values) : undefined;
  const hasSpell =
    ["cast", "damage", "aura", "resource", "summon"].includes(
      definition.family,
    ) && record.eventType !== "SWING_DAMAGE";
  const spell = hasSpell ? spellReference(values, 8) : undefined;
  const combatantGuid =
    definition.family === "combatant-info" ? values[0] : undefined;
  const combatant =
    combatantGuid === undefined
      ? undefined
      : actorReference(combatantGuid, undefined, undefined, undefined);

  return {
    ok: true,
    value: {
      timestamp: record.timestamp,
      relativeTimeTicks:
        record.timestamp.localTimeTicks - context.firstTimestampTicks,
      type: record.eventType,
      family: definition.family,
      normalized: true,
      ...(actors ?? {}),
      ...(combatant === undefined ? {} : { source: combatant }),
      ...(spell === undefined ? {} : { spell }),
      payload: eventPayload(definition, values),
      rawFields: record.fields,
      additionalFields: values.slice(definition.stableFieldCount),
      origin: context.origin,
      parserVersion: context.parserVersion,
      schemaId,
      raw: record.raw,
      location: record.location,
    },
    warnings: [],
  };
}

function definitions(
  entries: readonly (readonly [string, EventFamily, number, number])[],
): ReadonlyMap<string, CombatLogEventDefinition> {
  return new Map(
    entries.map(([eventType, family, minimumFields, stableFieldCount]) => [
      eventType,
      { eventType, family, minimumFields, stableFieldCount },
    ]),
  );
}

const RETAIL_12_1_0_DEFINITIONS = definitions([
  ["COMBAT_LOG_VERSION", "version", 7, 7],
  ["SPELL_CAST_START", "cast", 11, 11],
  ["SPELL_CAST_SUCCESS", "cast", 11, 11],
  ["SPELL_CAST_FAILED", "cast", 12, 12],
  ["SPELL_DAMAGE", "damage", 11, 11],
  ["SPELL_PERIODIC_DAMAGE", "damage", 11, 11],
  ["SWING_DAMAGE", "damage", 8, 8],
  ["RANGE_DAMAGE", "damage", 11, 11],
  ["SPELL_AURA_APPLIED", "aura", 12, 12],
  ["SPELL_AURA_REFRESH", "aura", 12, 12],
  ["SPELL_AURA_REMOVED", "aura", 12, 12],
  ["SPELL_AURA_APPLIED_DOSE", "aura", 13, 13],
  ["SPELL_AURA_REMOVED_DOSE", "aura", 13, 13],
  ["SPELL_ENERGIZE", "resource", 11, 11],
  ["SPELL_PERIODIC_ENERGIZE", "resource", 11, 11],
  ["SPELL_DRAIN", "resource", 11, 11],
  ["SPELL_SUMMON", "summon", 11, 11],
  ["SPELL_CREATE", "summon", 11, 11],
  ["UNIT_DIED", "death", 8, 8],
  ["UNIT_DESTROYED", "death", 8, 8],
  ["COMBATANT_INFO", "combatant-info", 1, 1],
  ["ENCOUNTER_START", "encounter", 5, 5],
  ["ENCOUNTER_END", "encounter", 6, 6],
]);

export const retail12_1_0Schema: CombatLogSchema = {
  id: "retail-12.1.0-project-1-log-22",
  compatibility: {
    projectId: 1,
    logVersions: [22],
    buildRange: { minimum: "12.1.0", maximum: "12.1.0" },
  },
  eventDefinitions: RETAIL_12_1_0_DEFINITIONS,
  discoveryBoundaries: {
    encounterStartEventTypes: ["ENCOUNTER_START"],
    encounterEndEventTypes: ["ENCOUNTER_END"],
    hardBoundaryEventTypes: ["COMBAT_LOG_VERSION", "ZONE_CHANGE", "MAP_CHANGE"],
    targetEndEventTypes: ["UNIT_DIED", "UNIT_DESTROYED"],
  },
  normalize(record, context) {
    return normalizeKnownEvent(this.id, this.eventDefinitions, record, context);
  },
};

export const defaultSchemaRegistry = new CombatLogSchemaRegistry([
  retail12_1_0Schema,
]);

export function parseCombatLogVersion(
  record: RawCombatLogRecord,
): OperationResult<CombatLogVersion> {
  const values = fieldValues(record);
  const logVersion = optionalNumber(values[0]);
  const buildVersion = values[4];
  const projectId = optionalNumber(values[6]);
  if (
    record.eventType !== "COMBAT_LOG_VERSION" ||
    logVersion === undefined ||
    values[1] !== "ADVANCED_LOG_ENABLED" ||
    !["0", "1"].includes(values[2] ?? "") ||
    values[3] !== "BUILD_VERSION" ||
    buildVersion === undefined ||
    values[5] !== "PROJECT_ID" ||
    projectId === undefined
  ) {
    return {
      ok: false,
      error: parserFailure(
        "MALFORMED_LOG_VERSION",
        "The combat-log version record has an unsupported structure.",
        record.location,
        record.raw,
      ),
      warnings: [],
    };
  }

  return {
    ok: true,
    value: {
      projectId,
      logVersion,
      buildVersion,
      advancedLoggingEnabled: values[2] === "1",
    },
    warnings: [],
  };
}
