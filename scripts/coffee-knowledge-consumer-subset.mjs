function clean(value) {
  return String(value ?? '').normalize('NFKC').trim();
}

function safeSourceRefs(value) {
  return Array.isArray(value) ? value.map(clean).filter(Boolean) : [];
}

function safeVarietyDetail(detail) {
  if (!detail?.id || detail?.coreCode) return null;
  const canonicalNameEn = clean(detail.canonicalNameEn);
  const sourceRefs = safeSourceRefs(detail.sourceRefs);
  const confidence = Number(detail.confidence ?? 0);
  if (!canonicalNameEn || sourceRefs.length === 0 || !Number.isFinite(confidence) || confidence < 0.9) return null;
  return {
    id: String(detail.id),
    recordType: clean(detail.recordType),
    canonicalNameEn,
    ...(Array.isArray(detail.aliases) && detail.aliases.length
      ? { aliases: detail.aliases.map(clean).filter(Boolean) }
      : {}),
    ...(detail.speciesId ? { speciesId: String(detail.speciesId) } : {}),
    ...(detail.geneticGroup ? { geneticGroup: clean(detail.geneticGroup) } : {}),
    ...(detail.lineage ? { lineage: clean(detail.lineage) } : {}),
    ...(detail.breeder ? { breeder: clean(detail.breeder) } : {}),
    ...(detail.releaseCountry ? { releaseCountry: clean(detail.releaseCountry) } : {}),
    ...(detail.releaseYear ? { releaseYear: Number(detail.releaseYear) } : {}),
    ...(detail.uniformityStatus ? { uniformityStatus: clean(detail.uniformityStatus) } : {}),
    sourceRefs,
    confidence,
    coreEligibility: clean(detail.coreEligibility)
  };
}

function safeLocalizedRecord(record, ids) {
  const targetId = String(record?.targetId ?? '');
  if (!targetId || !ids.has(targetId)) return null;
  const text = clean(record?.name ?? record?.alias);
  const confidence = Number(record?.confidence ?? 0.5);
  if (!text || !Number.isFinite(confidence) || confidence < 0.6) return null;
  return {
    targetId,
    language: clean(record.language),
    ...(record.name !== undefined ? { name: text } : { alias: text }),
    nameType: clean(record.nameType),
    confidence,
    reviewStatus: clean(record.reviewStatus),
    ...(Array.isArray(record.sourceRefs) ? { sourceRefs: safeSourceRefs(record.sourceRefs) } : {})
  };
}

export function buildCoffeeKnowledgeConsumerSubset(knowledge) {
  if (knowledge?._format !== 'coffee-knowledge-bundle' || knowledge?.contract !== 'coffee-knowledge/1.0') {
    throw new Error('Coffee Knowledge bundle identity is invalid');
  }
  if (knowledge?.compatibility?.qrIndexesChanged === true) {
    throw new Error('Coffee Knowledge consumer subset cannot accept QR index mutation');
  }

  const varietyDetails = (Array.isArray(knowledge?.unboundKnowledge?.varietyDetails)
    ? knowledge.unboundKnowledge.varietyDetails
    : [])
    .map(safeVarietyDetail)
    .filter(Boolean);
  const ids = new Set(varietyDetails.map(detail => detail.id));
  const localizedNames = (Array.isArray(knowledge.localizedNames) ? knowledge.localizedNames : [])
    .map(record => safeLocalizedRecord(record, ids))
    .filter(Boolean);
  const localizedAliases = (Array.isArray(knowledge.localizedAliases) ? knowledge.localizedAliases : [])
    .map(record => safeLocalizedRecord(record, ids))
    .filter(Boolean);

  return {
    _format: 'coffee-knowledge-bundle',
    contract: knowledge.contract,
    version: String(knowledge.version ?? ''),
    compatibility: { qrIndexesChanged: false },
    localizedNames,
    localizedAliases,
    unboundKnowledge: { varietyDetails }
  };
}

export function assertCoffeeKnowledgeConsumerSubset(subset) {
  if (subset?._format !== 'coffee-knowledge-bundle' || subset?.contract !== 'coffee-knowledge/1.0') {
    throw new Error('Coffee Knowledge consumer subset contract is invalid');
  }
  if (subset?.compatibility?.qrIndexesChanged !== false) {
    throw new Error('Coffee Knowledge consumer subset lacks frozen QR compatibility');
  }
  const details = subset?.unboundKnowledge?.varietyDetails;
  if (!Array.isArray(details) || details.length === 0) {
    throw new Error('Coffee Knowledge consumer subset has no knowledge-only varieties');
  }
  const seen = new Set();
  for (const detail of details) {
    if (!detail?.id || detail?.coreCode || !detail?.canonicalNameEn) {
      throw new Error(`Unsafe knowledge-only variety detail: ${detail?.id ?? 'missing-id'}`);
    }
    if (seen.has(detail.id)) throw new Error(`Duplicate knowledge-only variety id: ${detail.id}`);
    seen.add(detail.id);
    if (!Array.isArray(detail.sourceRefs) || detail.sourceRefs.length === 0) {
      throw new Error(`Knowledge-only variety lacks sourceRefs: ${detail.id}`);
    }
    if (Number(detail.confidence ?? 0) < 0.9) {
      throw new Error(`Knowledge-only variety confidence too low for consumer subset: ${detail.id}`);
    }
  }
  return details.length;
}
