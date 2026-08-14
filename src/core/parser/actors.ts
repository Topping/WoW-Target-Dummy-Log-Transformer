import type { ActorReference, ActorType } from "../contracts";

export function classifyActorGuid(guid: string): ActorType {
  if (guid.startsWith("Player-")) return "player";
  if (guid.startsWith("Pet-")) return "pet";
  if (guid.startsWith("Guardian-")) return "guardian";
  if (guid.startsWith("Vehicle-")) return "vehicle";
  if (guid.startsWith("Creature-")) return "creature";
  return "unknown";
}

export function actorReference(
  guid: string,
  name: string | undefined,
  flags: string | undefined,
  raidFlags: string | undefined,
): ActorReference {
  return {
    guid,
    type: classifyActorGuid(guid),
    ...(name === undefined || name === "nil" ? {} : { name }),
    ...(flags === undefined ? {} : { flags }),
    ...(raidFlags === undefined ? {} : { raidFlags }),
  };
}
