import type { OperationResult } from "../contracts";

export function splitNestedFields(
  value: string,
): readonly string[] | undefined {
  const fields: string[] = [];
  let start = 0;
  const stack: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(" || character === "[") stack.push(character);
    if (character === ")" || character === "]") {
      const open = stack.pop();
      if (
        (character === ")" && open !== "(") ||
        (character === "]" && open !== "[")
      )
        return undefined;
    }
    if (character === "," && stack.length === 0) {
      fields.push(value.slice(start, index));
      start = index + 1;
    }
  }
  if (stack.length > 0) return undefined;
  fields.push(value.slice(start));
  return fields;
}

function structuralFailure(message: string): OperationResult<never> {
  return {
    ok: false,
    error: {
      category: "internal",
      code: "INVALID_BUILT_COMBATANT_INFO",
      message,
      recoverable: true,
      suggestedAction:
        "Remove the invalid profile, then paste and validate fresh /simc output for the selected character.",
    },
    warnings: [],
  };
}

const INTEGER = /^(?:0|[1-9][0-9]*)$/u;

function tupleFields(value: string): readonly string[] | undefined {
  if (!value.startsWith("(") || !value.endsWith(")")) return undefined;
  const body = value.slice(1, -1);
  return body.length === 0 ? [] : splitNestedFields(body);
}

function arrayFields(value: string): readonly string[] | undefined {
  if (!value.startsWith("[") || !value.endsWith("]")) return undefined;
  const body = value.slice(1, -1);
  return body.length === 0 ? [] : splitNestedFields(body);
}

export function validateV22CombatantInfo(
  eventPayload: string,
): OperationResult<undefined> {
  if (!eventPayload.startsWith("COMBATANT_INFO,")) {
    return structuralFailure(
      "The built character metadata has the wrong event type.",
    );
  }
  const fields = splitNestedFields(
    eventPayload.slice("COMBATANT_INFO,".length),
  );
  if (fields?.length !== 33) {
    return structuralFailure(
      "The built character metadata has an invalid V22 top-level shape.",
    );
  }
  if (fields[0]?.startsWith("Player-") !== true) {
    return structuralFailure(
      "The built character metadata has an invalid player GUID.",
    );
  }
  if (!fields.slice(1, 25).every((field) => INTEGER.test(field))) {
    return structuralFailure(
      "The built character metadata contains a non-integer scalar.",
    );
  }
  const talents = arrayFields(fields[25] ?? "");
  if (
    talents === undefined ||
    talents.some((tuple) => {
      const parts = tupleFields(tuple);
      return parts?.length !== 3 || !parts.every((part) => INTEGER.test(part));
    })
  )
    return structuralFailure("The built talent list is invalid.");
  const pvp = tupleFields(fields[26] ?? "");
  if (
    pvp === undefined ||
    pvp.length === 0 ||
    !pvp.every((part) => INTEGER.test(part))
  ) {
    return structuralFailure("The built PvP talent tuple is invalid.");
  }
  const gear = arrayFields(fields[27] ?? "");
  if (gear?.length !== 18) {
    return structuralFailure(
      "The built equipment list does not contain 18 positional entries.",
    );
  }
  for (const item of gear) {
    const parts = tupleFields(item);
    if (
      parts?.length !== 5 ||
      !INTEGER.test(parts[0] ?? "") ||
      !INTEGER.test(parts[1] ?? "")
    ) {
      return structuralFailure("A built equipment tuple is invalid.");
    }
    const enchants = tupleFields(parts[2] ?? "");
    const bonuses = tupleFields(parts[3] ?? "");
    const gems = tupleFields(parts[4] ?? "");
    if (
      enchants === undefined ||
      (enchants.length !== 0 && enchants.length !== 3) ||
      bonuses === undefined ||
      gems === undefined ||
      ![...enchants, ...bonuses, ...gems].every((part) => INTEGER.test(part)) ||
      gems.length % 2 !== 0
    )
      return structuralFailure("A built equipment subtuple is invalid.");
  }
  if (
    arrayFields(fields[28] ?? "") === undefined ||
    !fields.slice(29).every((field) => INTEGER.test(field))
  ) {
    return structuralFailure("The built aura or expansion tail is invalid.");
  }
  return { ok: true, value: undefined, warnings: [] };
}
