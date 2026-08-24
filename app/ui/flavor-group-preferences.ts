import { DESCRIPTOR_GROUPS_V1 } from "../core/sensory-dictionary-v1";
import type { UserPreferencesRepository } from "../storage/user-preferences-repository";

const PREFERENCE_KEY = "ui.flavor-groups.v1";

export interface FlavorGroupPreferences {
  orderedGroupIds: readonly string[];
  collapsedGroupIds: readonly string[];
}

function defaultPreferences(): FlavorGroupPreferences {
  return {
    orderedGroupIds: DESCRIPTOR_GROUPS_V1.map((group) => group.id),
    collapsedGroupIds: DESCRIPTOR_GROUPS_V1
      .filter((group) => group.defaultCollapsed)
      .map((group) => group.id)
  };
}

function sanitize(input: FlavorGroupPreferences | undefined): FlavorGroupPreferences {
  const defaults = defaultPreferences();
  if (!input) {
    return defaults;
  }

  const known = new Set(defaults.orderedGroupIds);
  const ordered = input.orderedGroupIds.filter((id) => known.has(id));
  for (const id of defaults.orderedGroupIds) {
    if (!ordered.includes(id)) {
      ordered.push(id);
    }
  }

  const collapsed = input.collapsedGroupIds.filter((id) => known.has(id));
  return {
    orderedGroupIds: ordered,
    collapsedGroupIds: [...new Set(collapsed)]
  };
}

export class FlavorGroupPreferenceService {
  constructor(private readonly repository: UserPreferencesRepository) {}

  async load(): Promise<FlavorGroupPreferences> {
    return sanitize(await this.repository.get<FlavorGroupPreferences>(PREFERENCE_KEY));
  }

  async setCollapsed(groupId: string, collapsed: boolean, now: string): Promise<FlavorGroupPreferences> {
    const current = await this.load();
    if (!current.orderedGroupIds.includes(groupId)) {
      throw new Error(`UNKNOWN_DESCRIPTOR_GROUP:${groupId}`);
    }

    const nextCollapsed = new Set(current.collapsedGroupIds);
    if (collapsed) {
      nextCollapsed.add(groupId);
    } else {
      nextCollapsed.delete(groupId);
    }

    const next: FlavorGroupPreferences = {
      orderedGroupIds: current.orderedGroupIds,
      collapsedGroupIds: [...nextCollapsed]
    };
    await this.repository.set(PREFERENCE_KEY, next, now);
    return next;
  }

  async reorder(orderedGroupIds: readonly string[], now: string): Promise<FlavorGroupPreferences> {
    const current = await this.load();
    const expected = new Set(current.orderedGroupIds);
    if (
      orderedGroupIds.length !== expected.size ||
      new Set(orderedGroupIds).size !== expected.size ||
      orderedGroupIds.some((id) => !expected.has(id))
    ) {
      throw new Error("INVALID_DESCRIPTOR_GROUP_ORDER");
    }

    const next: FlavorGroupPreferences = {
      orderedGroupIds: [...orderedGroupIds],
      collapsedGroupIds: current.collapsedGroupIds
    };
    await this.repository.set(PREFERENCE_KEY, next, now);
    return next;
  }
}
