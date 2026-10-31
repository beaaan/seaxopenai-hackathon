import { z } from "zod";
import { prompt } from "../core/prompts";
import { policyText, type StageContext } from "../pipeline/context";
import { Dimension, type PolicyVersion } from "../shared/schema";
import { trigramSimilarity } from "./anchor";

const ExtractedDimensions = z.strictObject({
  dimensions: z.array(z.strictObject({
    id: z.string().regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/),
    name: z.string().min(1),
    description: z.string().min(1),
    rationale: z.string().min(1),
    levels: z.array(z.strictObject({
      id: z.string().regex(/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/),
      label: z.string().min(1),
      description: z.string().min(1),
    })).min(2).max(3),
  })).min(3).max(4),
});

/** Farthest-first lexical selection keeps distinct circulating claims / surfaces represented. */
function diverse<T>(items: readonly T[], count: number, text: (item: T) => string): T[] {
  if (items.length <= count) return [...items];
  const selected = [items[0]!];
  const remaining = items.slice(1);
  while (selected.length < count && remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = -1;
    for (const [index, item] of remaining.entries()) {
      const distance = Math.min(...selected.map((chosen) => 1 - trigramSimilarity(text(item), text(chosen))));
      if (distance > bestDistance) {
        bestIndex = index;
        bestDistance = distance;
      }
    }
    selected.push(remaining.splice(bestIndex, 1)[0]!);
  }
  return selected;
}

export async function extractDimensions(ctx: StageContext, version: PolicyVersion): Promise<Dimension[]> {
  const extracted = await ctx.gateway.structured({
    role: "dims",
    instructions: prompt("dims"),
    input: policyText(version, { ids: false }),
    schema: ExtractedDimensions,
    schemaName: "policy_dimensions",
    model: ctx.config.models.reader,
    effort: "medium",
  });
  const dimensions: Dimension[] = extracted.dimensions.map((dimension) => ({ ...dimension, origin: "extracted" }));
  for (const dimension of dimensions) {
    if (["exposure_channel", "prior_belief", "attention"].includes(dimension.id)) {
      throw new Error(`Reserved dimension id: ${dimension.id}`);
    }
  }
  const hasFolk = ctx.folk.versions.length > 0;
  // Cap channels at three: reserve one for friend when available, always retain
  // the primary (first) surface, then fill remaining slots by farthest-first text diversity.
  const surfaces = diverse(version.surfaces, hasFolk ? 2 : 3, (surface) => surface.text);
  const channelDimension: Dimension = {
    id: "exposure_channel",
    name: "Kênh tiếp xúc",
    description: "Phần văn bản hoặc lời truyền miệng thực sự đến được với người đọc.",
    levels: [
      ...surfaces.map((surface) => ({ id: surface.id, label: surface.label, description: `Chỉ xem nội dung ở kênh: ${surface.label}.` })),
      ...(hasFolk ? [{ id: "friend", label: "Nghe người quen kể", description: "Không xem văn bản chính thức; chỉ nghe một phiên bản từ bạn bè hoặc hàng xóm." }] : []),
    ],
    origin: "extracted",
    rationale: "Kênh tiếp xúc quyết định phần thông tin mà người đọc có, không phải toàn bộ chính sách.",
  };
  // A constant channel cannot split readings and would violate Dimension's two-level minimum.
  if (channelDimension.levels.length >= 2) dimensions.push(channelDimension);
  if (hasFolk) {
    const priors = diverse(ctx.folk.versions, 2, (folk) => `${folk.claimEn}\n${folk.textVi}`);
    dimensions.push({
      id: "prior_belief",
      name: "Niềm tin có sẵn",
      description: "Điều người đọc đã nghe trước khi gặp tình huống hiện tại.",
      levels: [
        { id: "none", label: "Chưa có niềm tin từ trước", description: "Chưa nghe một phiên bản truyền miệng nào về quy định này." },
        ...priors.map((folk) => ({ id: folk.id, label: folk.textVi, description: folk.claimEn })),
      ],
      origin: "extracted",
      rationale: "Các phiên bản truyền miệng khác nhau tạo kỳ vọng khác nhau khi đọc cùng một quy định.",
    });
  }
  dimensions.push({
    id: "attention",
    name: "Mức độ chú ý",
    description: "Thời gian và sự tập trung thực tế dành cho thông tin.",
    levels: [
      { id: "skim", label: "Đọc lướt khi đang bận", description: "Liếc điện thoại khoảng 20 giây trong lúc đang làm việc khác." },
      { id: "careful", label: "Đọc có chú ý", description: "Có thời gian đọc kỹ hơn, nhưng vẫn theo khả năng và thói quen của chính người này." },
    ],
    origin: "extracted",
    rationale: "Cùng một nội dung có thể được hiểu khác khi chỉ nhìn lướt so với khi có thời gian đọc.",
  });
  const ids = new Set<string>();
  for (const dimension of dimensions) {
    if (ids.has(dimension.id)) throw new Error(`Duplicate dimension id: ${dimension.id}`);
    ids.add(dimension.id);
    if (new Set(dimension.levels.map((level) => level.id)).size !== dimension.levels.length) {
      throw new Error(`Duplicate level id in dimension ${dimension.id}`);
    }
  }
  return dimensions.map((dimension) => Dimension.parse(dimension));
}
