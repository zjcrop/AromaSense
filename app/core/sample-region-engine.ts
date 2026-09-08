import type { OCRBox } from "./ocr-layout-model";

export interface RegionGeometryLine {
  id: string;
  box: OCRBox;
}

export interface GeometryRegionProposal {
  id: string;
  box: OCRBox;
  lineIds: readonly string[];
  confidence: number;
  evidence: readonly string[];
}

export interface GeometryRegionResult {
  strategy: "geometry-only/1.0";
  regions: readonly GeometryRegionProposal[];
  confidence: number;
  requiresReview: boolean;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizedBox(left: number, top: number, right: number, bottom: number): OCRBox {
  const boundedLeft = clamp01(left);
  const boundedTop = clamp01(top);
  const boundedRight = clamp01(right);
  const boundedBottom = clamp01(bottom);
  return {
    left: boundedLeft,
    top: boundedTop,
    right: boundedRight,
    bottom: boundedBottom,
    width: Math.max(0.0001, boundedRight - boundedLeft),
    height: Math.max(0.0001, boundedBottom - boundedTop),
    centerX: (boundedLeft + boundedRight) / 2,
    centerY: (boundedTop + boundedBottom) / 2
  };
}

function median(values: readonly number[], fallback: number): number {
  const sorted = values.filter(Number.isFinite).filter((value) => value > 0).sort((a, b) => a - b);
  if (!sorted.length) return fallback;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function horizontalOverlap(a: OCRBox, b: OCRBox): number {
  const overlap = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  return overlap / Math.max(0.0001, Math.min(a.width, b.width));
}

function verticalOverlap(a: OCRBox, b: OCRBox): number {
  const overlap = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return overlap / Math.max(0.0001, Math.min(a.height, b.height));
}

function horizontalGap(a: OCRBox, b: OCRBox): number {
  if (a.right < b.left) return b.left - a.right;
  if (b.right < a.left) return a.left - b.right;
  return 0;
}

function verticalGap(a: OCRBox, b: OCRBox): number {
  if (a.bottom < b.top) return b.top - a.bottom;
  if (b.bottom < a.top) return a.top - b.bottom;
  return 0;
}

function union(lines: readonly RegionGeometryLine[], paddingX: number, paddingY: number): OCRBox {
  const left = Math.min(...lines.map((line) => line.box.left));
  const top = Math.min(...lines.map((line) => line.box.top));
  const right = Math.max(...lines.map((line) => line.box.right));
  const bottom = Math.max(...lines.map((line) => line.box.bottom));
  return normalizedBox(left - paddingX, top - paddingY, right + paddingX, bottom + paddingY);
}

function connectedComponents(lines: readonly RegionGeometryLine[], medianHeight: number): RegionGeometryLine[][] {
  const count = lines.length;
  const adjacency = Array.from({ length: count }, () => new Set<number>());
  const verticalThreshold = Math.max(0.018, Math.min(0.085, medianHeight * 1.75));
  const horizontalThreshold = Math.max(0.025, Math.min(0.12, medianHeight * 3.2));

  for (let i = 0; i < count; i += 1) {
    for (let j = i + 1; j < count; j += 1) {
      const a = lines[i].box;
      const b = lines[j].box;
      const sameColumn = horizontalOverlap(a, b) >= 0.24 && verticalGap(a, b) <= verticalThreshold;
      const sameRow = verticalOverlap(a, b) >= 0.42 && horizontalGap(a, b) <= horizontalThreshold;
      const stronglyAligned = Math.abs(a.centerX - b.centerX) <= Math.max(a.width, b.width) * 0.22 && verticalGap(a, b) <= verticalThreshold * 1.3;
      if (sameColumn || sameRow || stronglyAligned) {
        adjacency[i].add(j);
        adjacency[j].add(i);
      }
    }
  }

  const visited = new Set<number>();
  const components: RegionGeometryLine[][] = [];
  for (let start = 0; start < count; start += 1) {
    if (visited.has(start)) continue;
    const queue = [start];
    const component: RegionGeometryLine[] = [];
    visited.add(start);
    while (queue.length) {
      const index = queue.shift()!;
      component.push(lines[index]);
      for (const next of adjacency[index]) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    components.push(component);
  }
  return components;
}

function splitTallComponent(lines: readonly RegionGeometryLine[], medianHeight: number): RegionGeometryLine[][] {
  if (lines.length < 4) return [lines.slice()];
  const ordered = [...lines].sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);
  const gaps = ordered.slice(1).map((line, index) => ({
    index: index + 1,
    gap: Math.max(0, line.box.top - ordered[index].box.bottom)
  }));
  const positive = gaps.map((item) => item.gap).filter((gap) => gap > 0);
  const typicalGap = median(positive, medianHeight * 0.45);
  const splitThreshold = Math.max(medianHeight * 1.65, typicalGap * 2.35, 0.026);
  const groups: RegionGeometryLine[][] = [[]];
  for (let index = 0; index < ordered.length; index += 1) {
    if (index > 0) {
      const gap = Math.max(0, ordered[index].box.top - ordered[index - 1].box.bottom);
      if (gap >= splitThreshold && groups[groups.length - 1].length >= 2) groups.push([]);
    }
    groups[groups.length - 1].push(ordered[index]);
  }
  return groups.filter((group) => group.length);
}

function mergeTinyComponents(components: RegionGeometryLine[][], medianHeight: number): RegionGeometryLine[][] {
  const large = components.filter((component) => component.length >= 2);
  const tiny = components.filter((component) => component.length < 2);
  if (!large.length) return components;
  for (const component of tiny) {
    const line = component[0];
    if (!line) continue;
    let bestIndex = -1;
    let bestDistance = Infinity;
    large.forEach((candidate, index) => {
      const box = union(candidate, 0, 0);
      const dx = Math.max(0, Math.abs(line.box.centerX - box.centerX) - box.width / 2);
      const dy = Math.max(0, Math.abs(line.box.centerY - box.centerY) - box.height / 2);
      const distance = Math.hypot(dx, dy * 1.15);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0 && bestDistance <= Math.max(0.09, medianHeight * 3.5)) large[bestIndex].push(line);
    else large.push([line]);
  }
  return large;
}

/**
 * Produces sample-region candidates from geometry only. OCR text is deliberately
 * excluded so an incorrect first recognition cannot change the crop boundaries.
 * The output is advisory: the review UI remains the authority and every accepted
 * region is re-read from the original image pixels.
 */
export function proposeSampleRegionsFromGeometry(lines: readonly RegionGeometryLine[]): GeometryRegionResult {
  const usable = lines
    .filter((line) => line.id && line.box.width > 0 && line.box.height > 0)
    .map((line) => ({ id: line.id, box: { ...line.box } }))
    .sort((a, b) => a.box.top - b.box.top || a.box.left - b.box.left);

  if (!usable.length) {
    return { strategy: "geometry-only/1.0", regions: [], confidence: 0.15, requiresReview: true };
  }
  if (usable.length === 1) {
    return {
      strategy: "geometry-only/1.0",
      regions: [{ id: "geometry-region-1", box: union(usable, 0.025, 0.025), lineIds: [usable[0].id], confidence: 0.55, evidence: ["single-component"] }],
      confidence: 0.55,
      requiresReview: true
    };
  }

  const medianHeight = median(usable.map((line) => line.box.height), 0.035);
  const components = mergeTinyComponents(
    connectedComponents(usable, medianHeight).flatMap((component) => splitTallComponent(component, medianHeight)),
    medianHeight
  ).filter((component) => component.length);

  const paddingX = Math.max(0.012, Math.min(0.045, medianHeight * 0.65));
  const paddingY = Math.max(0.010, Math.min(0.04, medianHeight * 0.58));
  const proposals = components
    .map((component, index) => {
      const box = union(component, paddingX, paddingY);
      const density = Math.min(1, component.length / 4);
      const compactness = Math.min(1, (component.reduce((sum, line) => sum + line.box.width * line.box.height, 0) / Math.max(0.0001, box.width * box.height)) * 5);
      const confidence = Math.max(0.48, Math.min(0.94, 0.52 + density * 0.24 + compactness * 0.18));
      return {
        id: `geometry-region-${index + 1}`,
        box,
        lineIds: component.map((line) => line.id),
        confidence,
        evidence: ["ocr-box-geometry", "adaptive-connectivity", "whitespace-gap"]
      } satisfies GeometryRegionProposal;
    })
    .sort((a, b) => {
      const rowTolerance = Math.max(a.box.height, b.box.height) * 0.25;
      if (Math.abs(a.box.top - b.box.top) <= rowTolerance) return a.box.left - b.box.left;
      return a.box.top - b.box.top;
    })
    .map((region, index) => ({ ...region, id: `geometry-region-${index + 1}` }));

  const meaningful = proposals.filter((proposal) => proposal.lineIds.length >= 2 || proposal.box.width * proposal.box.height >= 0.018);
  const regions = meaningful.length ? meaningful : proposals;
  const confidence = Math.min(...regions.map((region) => region.confidence));
  return {
    strategy: "geometry-only/1.0",
    regions,
    confidence,
    requiresReview: regions.length !== 1 || confidence < 0.82
  };
}
