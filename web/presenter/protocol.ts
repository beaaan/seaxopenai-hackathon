export type PresenterMessage =
  | { type: "at"; chapter: string; index: number; chapters: string[] }
  | { type: "goto"; chapter: string }
  | { type: "hello" }
  | { type: "qa"; id: string };

export type AudiencePosition = Extract<PresenterMessage, { type: "at" }>;

export function isPresenterMessage(value: unknown): value is PresenterMessage {
  if (typeof value !== "object" || value === null || !("type" in value)) return false;
  switch (value.type) {
    case "hello":
      return true;
    case "goto":
      return "chapter" in value && typeof value.chapter === "string";
    case "qa":
      return "id" in value && typeof value.id === "string";
    case "at":
      return (
        "chapter" in value && typeof value.chapter === "string" &&
        "index" in value && typeof value.index === "number" && Number.isInteger(value.index) &&
        "chapters" in value && Array.isArray(value.chapters) &&
        value.chapters.every((chapter: unknown) => typeof chapter === "string")
      );
    default:
      return false;
  }
}
