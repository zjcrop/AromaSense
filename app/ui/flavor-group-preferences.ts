import { DESCRIPTOR_GROUPS_V1 } from "../core/sensory-dictionary-v1";
import type { UserPreferencesRepository } from "../storage/user-preferences-repository";

const PREFERENCE_KEY = "ui.flavor-groups.v1";

export interface FlavorGroupPreferences {
  orderedGroupIds: readonly string[];
  collapsedGroupIds: readonly string[];
  descriptorOrderByGroup: Readonly<Record<string, readonly string[]>>;
}

function defaultDescriptorOrder(): Record<string, readonly string[]> {
  return Object.fromEntries(
    DESCRIPTOR_GROUPS_V1.map((group) => [group.id, group.descriptors.map((item) => item.id)])
  );
}

function defaultPreferences(): FlavorGroupPreferences {
  return {
    orderedGroupIds: DESCRIPTOR_GROUPS_V1.map((group) => group.id),
    collapsedGroupIds: DESCRIPTOR_GROUPS_V1
      .filter((group) => group.defaultCollapsed)
      .map((group) => group.id),
    descriptorOrderByGroup: defaultDescriptorOrder()
  };
}

function sanitizeOrder(input: readonly string[] | undefined, expected: readonly string[]): readonly string[] {
  const known = new Set(expected);
  const result = (input ?? []).filter((id) => known.has(id));
  for (const id of expected) if (!result.includes(id)) result.push(id);
  return [...new Set(result)];
}

function sanitize(input: FlavorGroupPreferences | undefined): FlavorGroupPreferences {
  const defaults = defaultPreferences();
  if (!input) return defaults;

  const orderedGroupIds = sanitizeOrder(input.orderedGroupIds, defaults.orderedGroupIds);
  const knownGroups = new Set(defaults.orderedGroupIds);
  const collapsedGroupIds = [...new Set(input.collapsedGroupIds.filter((id) => knownGroups.has(id)))];
  const descriptorOrderByGroup: Record<string, readonly string[]> = {};

  for (const group of DESCRIPTOR_GROUPS_V1) {
    const expected = group.descriptors.map((item) => item.id);
    descriptorOrderByGroup[group.id] = sanitizeOrder(input.descriptorOrderByGroup?.[group.id], expected);
  }

  return { orderedGroupIds, collapsedGroupIds, descriptorOrderByGroup };
}

export class FlavorGroupPreferenceService {
  constructor(private readonly repository: UserPreferencesRepository) {}

  async load(): Promise<FlavorGroupPreferences> {
    return sanitize(await this.repository.get<FlavorGroupPreferences>(PREFERENCE_KEY));
  }

  async setCollapsed(groupId: string, collapsed: boolean, now: string): Promise<FlavorGroupPreferences> {
    const current = await this.load();
    if (!current.orderedGroupIds.includes(groupId)) throw new Error(`UNKNOWN_DESCRIPTOR_GROUP:${groupId}`);

    const nextCollapsed = new Set(current.collapsedGroupIds);
    if (collapsed) nextCollapsed.add(groupId); else nextCollapsed.delete(groupId);
    const next: FlavorGroupPreferences = {
      ...current,
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
    ) throw new Error("INVALID_DESCRIPTOR_GROUP_ORDER");

    const next: FlavorGroupPreferences = { ...current, orderedGroupIds: [...orderedGroupIds] };
    await this.repository.set(PREFERENCE_KEY, next, now);
    return next;
  }

  async reorderDescriptors(
    groupId: string,
    orderedDescriptorIds: readonly string[],
    now: string
  ): Promise<FlavorGroupPreferences> {
    const current = await this.load();
    const expectedList = current.descriptorOrderByGroup[groupId];
    if (!expectedList) throw new Error(`UNKNOWN_DESCRIPTOR_GROUP:${groupId}`);
    const expected = new Set(expectedList);
    if (
      orderedDescriptorIds.length !== expected.size ||
      new Set(orderedDescriptorIds).size !== expected.size ||
      orderedDescriptorIds.some((id) => !expected.has(id))
    ) throw new Error(`INVALID_DESCRIPTOR_ORDER:${groupId}`);

    const next: FlavorGroupPreferences = {
      ...current,
      descriptorOrderByGroup: {
        ...current.descriptorOrderByGroup,
        [groupId]: [...orderedDescriptorIds]
      }
    };
    await this.repository.set(PREFERENCE_KEY, next, now);
    return next;
  }
}
