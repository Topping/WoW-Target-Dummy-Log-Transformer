import {
  parseTimestamp,
  type Actor,
  type DiscoveryResult,
  type Session,
  type SessionCandidate,
  type SessionConfidence,
} from "../src/core";

function timestamp(raw: string) {
  const result = parseTimestamp(raw);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const start = timestamp("8/14/2026 12:46:23.3732");
const end = timestamp("8/14/2026 12:47:50.7862");

const targetGuids = [
  "Creature-Target-1",
  "Creature-Target-2",
  "Creature-Target-3",
  "Creature-Target-4",
  "Creature-Target-5",
] as const;

export function makeCandidate(
  id: string,
  confidence: SessionConfidence = "likely",
  playerGuid = "Player-Recorder",
  targets: readonly [string, ...string[]] = targetGuids,
): SessionCandidate {
  return {
    id,
    playerGuid,
    targetGuids: targets,
    startTime: start,
    endTime: end,
    durationTicks: end.localTimeTicks - start.localTimeTicks,
    confidence,
    reasons: [
      {
        code:
          confidence === "likely" ? "MINIMUM_DURATION_MET" : "SHORT_DURATION",
        description:
          confidence === "likely"
            ? "The activity lasted long enough to look deliberate."
            : "The activity was brief.",
      },
    ],
    qualifyingActionCount: 20,
    playerInitiatedActionCount: 10,
  };
}

export function makeDiscovery(
  proposedRecorderGuid: string | null = "Player-Recorder",
): DiscoveryResult {
  const likely = makeCandidate("likely-five-targets");
  const possible = makeCandidate(
    "possible-session",
    "possible",
    "Player-Recorder",
    [targetGuids[0]],
  );
  const incidental = makeCandidate(
    "incidental-session",
    "incidental",
    "Player-Recorder",
    [targetGuids[0]],
  );
  return {
    parser: {
      parserVersion: "0.2.0",
      schema: { id: "test-schema", selection: "exact" },
    },
    file: { name: "anything.bin", sizeBytes: 4096 },
    players: [
      {
        guid: "Player-Recorder",
        name: "Pølsefatter-ArgentDawn-EU",
        type: "player",
        activityScore: 1,
        recorderCandidate: proposedRecorderGuid === "Player-Recorder",
        outgoingCastCount: 10,
        outgoingDamageCount: 10,
        interactionDurationTicks: 874_130n,
        targetInteractionCount: 5,
      },
      {
        guid: "Player-Other",
        name: "Nearby-MoonGuard-US",
        type: "player",
        activityScore: 0.5,
        recorderCandidate: proposedRecorderGuid === "Player-Other",
        outgoingCastCount: 4,
        outgoingDamageCount: 3,
        interactionDurationTicks: 50_000n,
        targetInteractionCount: 1,
      },
    ],
    ...(proposedRecorderGuid === null ? {} : { proposedRecorderGuid }),
    targets: targetGuids.map((guid, index) => ({
      guid,
      name: "Cleave Training Dummy",
      type: "creature" as const,
      interactionCount: 20,
      damageFromPlayer: 1000 + index,
      interactingPlayerCount: 1,
      interactionDurationTicks: 874_130n,
      activityScore: 0.9,
    })),
    sessions: [likely, possible, incidental],
    ownedEntities: [],
    encounterEnvelopes: [],
    recordsScanned: 100,
    retainedState: {
      actorCount: 8,
      targetCount: 5,
      candidateWindowCount: 3,
      ownedEntityCount: 0,
      encounterEnvelopeCount: 0,
      retainedCombatEventCount: 0,
      retainedRawLineCount: 0,
    },
  };
}

function actor(
  guid: string,
  name: string,
  relationship: Actor["relationship"],
): Actor {
  return { guid, name, type: "creature", relationship };
}

export function makeSession(): Session {
  const targets = targetGuids.map((guid) =>
    actor(guid, "Cleave Training Dummy", "target"),
  );
  const [first, second, third, fourth, fifth] = targets;
  if (
    first === undefined ||
    second === undefined ||
    third === undefined ||
    fourth === undefined ||
    fifth === undefined
  ) {
    throw new Error("The UI fixture requires five targets.");
  }
  const controlled: Actor = {
    guid: "Guardian-Companion",
    name: "Risen Ghoul",
    type: "guardian",
    relationship: "owned-by-primary",
    ownerGuid: "Player-Recorder",
    ownershipEvidence: ["summon", "affiliation-mine"],
  };
  return {
    id: "likely-five-targets",
    parser: {
      parserVersion: "0.2.0",
      schema: { id: "test-schema", selection: "exact" },
    },
    startTime: start,
    endTime: end,
    durationTicks: end.localTimeTicks - start.localTimeTicks,
    player: {
      guid: "Player-Recorder",
      name: "Pølsefatter-ArgentDawn-EU",
      type: "player",
      relationship: "primary",
    },
    targets: [first, second, third, fourth, fifth],
    actors: [controlled, ...targets],
    events: [],
    warnings: [
      {
        code: "SESSION_SOFT_EVENT_LIMIT_EXCEEDED",
        severity: "warning",
        message: "This complete session is unusually large.",
      },
    ],
    statistics: {
      relevantEventCount: 42,
      removedEventCount: 58,
      controlledEntityCount: 1,
      externalEffectCount: 2,
      unknownEventTypeCount: 3,
      targets: [
        {
          targetGuid: targetGuids[0],
          relevantEventCount: 10,
          outgoingEventCount: 8,
          incomingEventCount: 2,
          damageEventCount: 7,
          observedDamageAmount: 1000,
        },
        ...targetGuids.slice(1).map((targetGuid) => ({
          targetGuid,
          relevantEventCount: 8,
          outgoingEventCount: 8,
          incomingEventCount: 0,
          damageEventCount: 6,
          observedDamageAmount: 900,
        })),
      ],
      filtering: {
        consideredRecordCount: 100,
        keptRecordCount: 42,
        removedRecordCount: 58,
        keptByReason: {
          "primary-outgoing": 20,
          "owned-entity-outgoing": 10,
          "primary-incoming": 5,
          "owned-entity-incoming": 2,
          "selected-target-metadata": 4,
          "required-metadata": 1,
        },
        removedByReason: {
          "unrelated-player-activity": 40,
          "unrelated-creature-activity": 10,
          "unrelated-record": 8,
        },
        skippedBeforePreRollCount: 9,
        stoppedAfterPostRoll: true,
        bytesRead: 2048,
        estimatedRetainedBytes: 1024,
      },
    },
  };
}
