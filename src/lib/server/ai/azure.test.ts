import { describe, expect, it } from "vitest";
import { AzureOpenAIError, extractJson } from "@/lib/server/ai";

describe("extractJson", () => {
  it("parses plain JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips markdown code fences", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("salvages the outermost object from prose", () => {
    expect(extractJson('Here you go: {"a":1} cheers')).toEqual({ a: 1 });
  });

  it("throws the typed error when there is no JSON at all", () => {
    expect(() => extractJson("definitely not json")).toThrow(AzureOpenAIError);
  });

  it("throws the typed error, not a SyntaxError, when the salvage is malformed", () => {
    expect(() => extractJson("a { not json } b")).toThrow(AzureOpenAIError);
  });
});
