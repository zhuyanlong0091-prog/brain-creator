import type { SystemBrainPage } from "../knowledge/systemBrain.js";
import type { SystemPageIdentity } from "./types.js";
import { canonicalPageIdentityKey, canonicalPageRoute } from "../shared/pageIdentity.js";

export { canonicalPageIdentityKey } from "../shared/pageIdentity.js";

export type SystemPageIdentityStore = {
  systemPageIdentities: SystemPageIdentity[];
  persist(): void;
};

export class SystemPageIdentityService {
  constructor(private readonly store: SystemPageIdentityStore) {}

  sync(input: { systemId: string; pages: SystemBrainPage[] }) {
    const now = new Date().toISOString();
    let changed = false;
    const identities = input.pages.map((page) => {
      const identityKey = canonicalPageIdentityKey(page.route);
      const confidence = page.probeIssueCount > 0
        ? 0.5
        : page.locators.length > 0
          ? Math.min(...page.locators.map((locator) => locator.confidence))
          : 0.8;
      const existing = this.store.systemPageIdentities.find(
        (item) => item.systemId === input.systemId && item.identityKey === identityKey
      );
      const sourceRefs = unique([...(existing?.sourceRefs ?? []), ...page.sourceRefs]);
      const next: SystemPageIdentity = existing
        ? {
            ...existing,
            canonicalRoute: canonicalPageRoute(page.route),
            semanticRole: pageSemanticRole(page.name),
            latestPageModelId: page.pageModelId,
            revision: Math.max(existing.revision, page.version),
            status: existing.latestPageModelId === page.pageModelId ? existing.status : "candidate",
            confidence,
            sourceRefs,
            updatedAt: now
          }
        : {
            id: `systemPageIdentity_${input.systemId}_${identityKey.replace(/[^a-z0-9:_-]+/giu, "_")}`,
            systemId: input.systemId,
            identityKey,
            canonicalRoute: canonicalPageRoute(page.route),
            semanticRole: pageSemanticRole(page.name),
            latestPageModelId: page.pageModelId,
            revision: page.version,
            status: "candidate",
            confidence,
            sourceRefs,
            createdAt: now,
            updatedAt: now
          };
      if (!existing || JSON.stringify(existing) !== JSON.stringify(next)) changed = true;
      if (existing) Object.assign(existing, next);
      else this.store.systemPageIdentities.push(next);
      return existing ?? next;
    });
    if (changed) this.store.persist();
    return identities;
  }

  confirmSnapshotIdentities(input: {
    systemId: string;
    assetIdentityKeys: string[];
    confirmedBy: string;
  }) {
    const keys = new Set(input.assetIdentityKeys);
    const now = new Date().toISOString();
    let changed = false;
    for (const identity of this.store.systemPageIdentities) {
      if (identity.systemId !== input.systemId || !keys.has(identity.identityKey)) continue;
      identity.status = "confirmed";
      identity.lastConfirmedRevision = identity.revision;
      identity.confirmedAt = now;
      identity.confirmedBy = input.confirmedBy;
      identity.updatedAt = now;
      changed = true;
    }
    if (changed) this.store.persist();
    return this.list(input.systemId);
  }

  list(systemId: string) {
    return this.store.systemPageIdentities
      .filter((identity) => identity.systemId === systemId)
      .sort((left, right) => left.identityKey.localeCompare(right.identityKey));
  }
}

export function pageSemanticRole(value: string) {
  const normalized = value.toLowerCase();
  if (/list|列表|台账|清单/iu.test(normalized)) return "list";
  if (/detail|详情|查看/iu.test(normalized)) return "detail";
  if (/form|表单|新建|创建|编辑|修改/iu.test(normalized)) return "form";
  if (/approval|审批|审核/iu.test(normalized)) return "approval";
  if (/dashboard|看板|工作台/iu.test(normalized)) return "dashboard";
  return "page";
}

function unique(values: string[]) {
  return [...new Set(values)];
}
