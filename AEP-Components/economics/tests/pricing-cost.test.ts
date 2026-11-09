import { describe, expect, it } from "vitest";
import { PriceCatalog, createPriceCatalog } from "../lib/pricing.js";
import {
  estimateCost,
  estimateCostFromUsage,
  estimateTokens,
  microUsdToUsd,
  totalMicroUsd,
} from "../lib/cost-estimator.js";
import type { PriceCatalogEntry } from "../lib/types.js";

const entries: PriceCatalogEntry[] = [
  { provider: "openai", model: "gpt-x", price: { prompt: 5, completion: 15 } },
  { provider: "openai", model: "gpt-mini", price: { prompt: 0.5, completion: 1.5 } },
  { provider: "anthropic", model: "claude-y", price: { prompt: 3, completion: 15 } },
  { provider: "together", model: "meta/llama-z", price: { prompt: 0.2, completion: 0.2 } },
];

describe("PriceCatalog", () => {
  it("looks up entries and prices by provider and model", () => {
    const cat = new PriceCatalog(entries);
    expect(cat.size).toBe(4);
    expect(cat.lookup("anthropic", "claude-y")?.price.prompt).toBe(3);
    expect(cat.getPrice("openai", "gpt-mini")).toEqual({ prompt: 0.5, completion: 1.5 });
    expect(cat.lookup("openai", "claude-y")).toBeNull();
    expect(cat.getPrice("nobody", "nothing")).toBeNull();
  });

  it("lists entries per provider and in total", () => {
    const cat = createPriceCatalog(entries);
    expect(cat.listByProvider("openai").map((e) => e.model)).toEqual(["gpt-x", "gpt-mini"]);
    expect(cat.listByProvider("mistral")).toEqual([]);
    expect(cat.listAll()).toHaveLength(4);
  });

  it("findCheapest compares prompt prices and keeps the model path after the first slash", () => {
    const cat = new PriceCatalog(entries);
    expect(cat.findCheapest(["openai/gpt-x", "anthropic/claude-y"])?.model).toBe("claude-y");
    expect(cat.findCheapest(["openai/gpt-x", "together/meta/llama-z"])?.model).toBe("meta/llama-z");
    expect(cat.findCheapest(["unknown/model", "openai/gpt-mini"])?.model).toBe("gpt-mini");
    expect(cat.findCheapest(["unknown/model"])).toBeNull();
    expect(cat.findCheapest([])).toBeNull();
  });

  it("validate reports an empty catalog and duplicate provider/model keys", () => {
    expect(new PriceCatalog().validate()).toEqual(["Price catalog is empty"]);
    expect(new PriceCatalog(entries).validate()).toEqual([]);
    const dup = new PriceCatalog([
      ...entries,
      { provider: "openai", model: "gpt-x", price: { prompt: 9, completion: 9 } },
    ]);
    expect(dup.validate()).toEqual(["Duplicate entry: openai/gpt-x"]);
    // The later duplicate wins the lookup.
    expect(dup.getPrice("openai", "gpt-x")?.prompt).toBe(9);
    expect(dup.size).toBe(4);
  });
});

describe("estimateTokens", () => {
  it("returns 0 for empty text", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates 1.3 tokens per space-separated word, rounded up", () => {
    expect(estimateTokens("one two three four five six seven eight nine ten")).toBe(13);
    expect(estimateTokens("single")).toBe(2);
    expect(estimateTokens("  spaced   words  ")).toBe(3);
    expect(estimateTokens("line one\nline two\tend")).toBe(7);
  });

  it("falls back to characters / 4 when there are no words", () => {
    expect(estimateTokens("        ")).toBe(2);
  });
});

describe("estimateCost", () => {
  const price = entries[0];
  if (!price) throw new Error("fixture missing");

  it("computes micro-USD as tokens times the per-million price", () => {
    const est = estimateCost({
      prompt_tokens: 1000,
      expected_output_tokens: 200,
      provider: "openai",
      model: "gpt-x",
      price_entry: price,
    });
    expect(est).toEqual({
      estimated_input_tokens: 1000,
      estimated_output_tokens: 200,
      estimated_prompt_micro_usd: 5000,
      estimated_completion_micro_usd: 3000,
      provider: "openai",
      model: "gpt-x",
      price_per_million_prompt: 5,
      price_per_million_completion: 15,
      from_cache: false,
    });
    expect(totalMicroUsd(est)).toBe(8000);
    expect(microUsdToUsd(totalMicroUsd(est))).toBe("$0.008000");
  });

  it("estimates prompt tokens from text and output as 30 percent of the prompt", () => {
    const est = estimateCost({
      prompt_text: "one two three four five six seven eight nine ten",
      provider: "openai",
      model: "gpt-x",
      price_entry: price,
    });
    expect(est.estimated_input_tokens).toBe(13);
    expect(est.estimated_output_tokens).toBe(4);
    expect(est.estimated_prompt_micro_usd).toBe(65);
    expect(est.estimated_completion_micro_usd).toBe(60);
  });

  it("omits the completion cost key when no output is expected", () => {
    const est = estimateCost({
      prompt_tokens: 10,
      expected_output_tokens: 0,
      provider: "openai",
      model: "gpt-x",
      price_entry: price,
    });
    expect("estimated_completion_micro_usd" in est).toBe(false);
    expect(totalMicroUsd(est)).toBe(50);
  });

  it("rounds micro-USD to two decimals", () => {
    const cheap = entries[3];
    if (!cheap) throw new Error("fixture missing");
    const est = estimateCost({
      prompt_tokens: 3,
      expected_output_tokens: 7,
      provider: "together",
      model: "meta/llama-z",
      price_entry: { ...cheap, price: { prompt: 0.3333, completion: 0.1111 } },
    });
    expect(est.estimated_prompt_micro_usd).toBe(1);
    expect(est.estimated_completion_micro_usd).toBe(0.78);
  });

  it("estimateCostFromUsage prices actual usage", () => {
    const est = estimateCostFromUsage(2000, 500, "anthropic", "claude-y", {
      provider: "anthropic",
      model: "claude-y",
      price: { prompt: 3, completion: 15 },
    });
    expect(est.estimated_prompt_micro_usd).toBe(6000);
    expect(est.estimated_completion_micro_usd).toBe(7500);
    expect(microUsdToUsd(totalMicroUsd(est))).toBe("$0.013500");
  });
});
