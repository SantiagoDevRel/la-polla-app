import { describe, expect, it, vi } from "vitest";
import {
  PROOF_INPUT_MAX_BYTES,
  PROOF_SKIP_BYTES,
  PROOF_UPLOAD_MAX_BYTES,
  isHeicLike,
  orderProofCandidates,
  parseStoredProofRecord,
  proofTargetDimensions,
  shouldKeepOriginal,
  storedRecordMatchesSource,
} from "@/lib/casa/proof-image";
import { submitProof, type ProofSubmitDeps, type SubmitCandidate } from "@/lib/casa/proof-submit";

const sha = (char: string) => char.repeat(64);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

describe("proofTargetDimensions", () => {
  it.each([
    [1179, 2556, 738, 1600],
    [1080, 2400, 720, 1600],
    [4000, 3000, 1600, 1200],
    [1080, 6000, 720, 4000],
    [500, 200, 500, 200],
    [2556, 1179, 1600, 738],
    [8160, 6120, 1600, 1200],
  ])("%ix%i -> %ix%i", (width, height, expectedWidth, expectedHeight) => {
    expect(proofTargetDimensions(width, height)).toEqual({ width: expectedWidth, height: expectedHeight });
  });

  it.each([
    [1080, 20000],
    [100, 2500],
    [0, 100],
    [100, 0],
    [Number.NaN, 100],
    [100, Number.POSITIVE_INFINITY],
    [-10, 100],
  ])("%sx%s has no legible reduction", (width, height) => {
    expect(proofTargetDimensions(width, height)).toBeNull();
  });

  it("never exceeds 4 MP nor Telegram limits", () => {
    for (const [w, h] of [[1179, 2556], [1080, 6000], [4000, 3000], [3000, 9000], [720, 14000]]) {
      const target = proofTargetDimensions(w, h);
      if (!target) continue;
      expect(target.width * target.height).toBeLessThanOrEqual(4_000_000);
      expect(target.width + target.height).toBeLessThanOrEqual(10_000);
      expect(Math.min(target.width, target.height)).toBeGreaterThanOrEqual(Math.min(720, w, h));
    }
  });
});

describe("shouldKeepOriginal", () => {
  it("keeps the original when the saving is under 10%", () => {
    expect(shouldKeepOriginal(1_000_000, 950_000)).toBe(true);
    expect(shouldKeepOriginal(1_000_000, 1_200_000)).toBe(true);
    expect(shouldKeepOriginal(1_000_000, 900_000)).toBe(false);
    expect(shouldKeepOriginal(3_000_000, 250_000)).toBe(false);
  });

  it("keeps the original for invalid prepared sizes", () => {
    expect(shouldKeepOriginal(1_000_000, 0)).toBe(true);
    expect(shouldKeepOriginal(1_000_000, Number.NaN)).toBe(true);
  });
});

describe("orderProofCandidates", () => {
  const compressed = { sha256: sha("a"), label: "compressed" };
  const original = { sha256: sha("b"), label: "original" };

  it("keeps the preparation order without a stored attempt", () => {
    expect(orderProofCandidates([compressed, original]).map((c) => c.label)).toEqual(["compressed", "original"]);
    expect(orderProofCandidates([compressed, original], sha("f")).map((c) => c.label)).toEqual(["compressed", "original"]);
  });

  it("puts the stored attempt first", () => {
    expect(orderProofCandidates([compressed, original], sha("b")).map((c) => c.label)).toEqual(["original", "compressed"]);
  });

  it("removes duplicate hashes", () => {
    const same = { sha256: sha("a"), label: "duplicate" };
    expect(orderProofCandidates([compressed, same, original]).map((c) => c.label)).toEqual(["compressed", "original"]);
  });
});

describe("stored proof records", () => {
  it("accepts new and legacy records, rejects malformed ones", () => {
    expect(parseStoredProofRecord(JSON.stringify({ sha256: sha("a"), requestId: uuid(1) }))).toEqual({ sha256: sha("a"), requestId: uuid(1) });
    expect(parseStoredProofRecord(JSON.stringify({ sourceSha256: sha("b"), sha256: sha("a"), requestId: uuid(1), attemptId: uuid(2) })))
      .toEqual({ sourceSha256: sha("b"), sha256: sha("a"), requestId: uuid(1), attemptId: uuid(2) });
    for (const raw of [null, "", "null", "{", "[]", JSON.stringify({ sha256: "x", requestId: uuid(1) }), JSON.stringify({ sha256: sha("a"), requestId: "x" }),
      JSON.stringify({ sha256: sha("a"), requestId: uuid(1), sourceSha256: 4 })]) {
      expect(parseStoredProofRecord(raw)).toBeNull();
    }
  });

  it("matches the ORIGINAL file, using sha256 for legacy records", () => {
    expect(storedRecordMatchesSource({ sha256: sha("b"), requestId: uuid(1) }, sha("b"))).toBe(true);
    expect(storedRecordMatchesSource({ sourceSha256: sha("b"), sha256: sha("a"), requestId: uuid(1) }, sha("b"))).toBe(true);
    expect(storedRecordMatchesSource({ sourceSha256: sha("c"), sha256: sha("b"), requestId: uuid(1) }, sha("b"))).toBe(false);
  });

  it("detects HEIC by type or extension", () => {
    expect(isHeicLike("image/heic")).toBe(true);
    expect(isHeicLike("", "IMG_0001.HEIF")).toBe(true);
    expect(isHeicLike("image/jpeg", "foto.jpg")).toBe(false);
  });

  it("keeps the documented byte limits", () => {
    expect(PROOF_SKIP_BYTES).toBe(300 * 1024);
    expect(PROOF_UPLOAD_MAX_BYTES).toBe(8 * 1024 * 1024);
    expect(PROOF_INPUT_MAX_BYTES).toBe(20 * 1024 * 1024);
  });
});

function candidate(char: string, contentType: SubmitCandidate["contentType"] = "image/jpeg"): SubmitCandidate {
  return { blob: new Blob([char]), sha256: sha(char), contentType, bytes: 100 };
}

function harness(responses: (body: Record<string, unknown>) => unknown, initial: string | null = null) {
  let stored = initial;
  let ids = 10;
  const calls: Record<string, unknown>[] = [];
  const uploads: string[] = [];
  const deps: ProofSubmitDeps = {
    post: vi.fn(async (body) => { calls.push(body); return responses(body); }),
    upload: vi.fn(async (_upload, blob) => { uploads.push(await blob.text()); return null; }),
    readRecord: () => stored,
    writeRecord: (value) => { stored = value; },
    newRequestId: () => uuid(ids++),
  };
  return { deps, calls, uploads, stored: () => JSON.parse(stored ?? "null") };
}

const fail = (code: string) => Object.assign(new Error(code), { code });
const upload = { bucket: "payment-proofs", path: "casa/x.jpg", token: "t" };

describe("submitProof", () => {
  const compressed = candidate("a");
  const original = candidate("b", "image/png");

  it("uploads the prepared bytes and stores the original hash", async () => {
    const h = harness((body) => body.action === "begin" ? { attempt_id: uuid(1), state: "uploading", upload } : { ok: true });
    const result = await submitProof({ sourceSha256: sha("b"), candidates: [compressed, original], ticketNumber: 7 }, h.deps);
    expect(result).toEqual({ attemptId: uuid(1), sha256: sha("a"), entryNumber: null });
    expect(h.calls[0]).not.toHaveProperty("entryNumber");
    expect(h.calls.map((c) => c.action)).toEqual(["begin", "confirm"]);
    expect(h.calls[0]).toMatchObject({ sha256: sha("a"), contentType: "image/jpeg", bytes: 100, ticketNumber: 7 });
    expect(h.uploads).toEqual(["a"]);
    expect(h.stored()).toMatchObject({ sourceSha256: sha("b"), sha256: sha("a"), attemptId: uuid(1) });
  });

  it("sends the participation and returns the one that received the proof (migration 131)", async () => {
    const h = harness((body) => body.action === "begin" ? { attempt_id: uuid(1), entry_number: 3, state: "uploading", upload } : { ok: true });
    const fresh = await submitProof({ sourceSha256: sha("b"), candidates: [compressed], ticketNumber: null, entryNumber: null }, h.deps);
    expect(h.calls[0]).toMatchObject({ action: "begin", entryNumber: null });
    expect(fresh.entryNumber).toBe(3);
    const retry = harness((body) => body.action === "begin" ? { attempt_id: uuid(1), entry_number: 2, state: "confirmed" } : { ok: true });
    const again = await submitProof({ sourceSha256: sha("b"), candidates: [compressed], ticketNumber: null, entryNumber: 2 }, retry.deps);
    expect(retry.calls[0]).toMatchObject({ action: "begin", entryNumber: 2 });
    expect(again.entryNumber).toBe(2);
  });

  it("does not try another candidate when the receipt already backs another participation", async () => {
    const h = harness((body) => { if (body.action === "begin") throw fail("DUPLICATE_PROOF"); return { ok: true }; });
    await expect(submitProof({ sourceSha256: sha("b"), candidates: [compressed, original], ticketNumber: null, entryNumber: null }, h.deps))
      .rejects.toMatchObject({ code: "DUPLICATE_PROOF" });
    expect(h.calls.filter((c) => c.action === "begin")).toHaveLength(1);
  });

  it("falls back to the original when another tab or client is uploading other bytes", async () => {
    const h = harness((body) => {
      if (body.action === "begin" && body.sha256 === sha("a")) throw fail("UPLOAD_IN_PROGRESS");
      if (body.action === "begin") return { attempt_id: uuid(2), state: "uploading", upload: { ...upload, token: null } };
      return { ok: true };
    });
    const result = await submitProof({ sourceSha256: sha("b"), candidates: [compressed, original], ticketNumber: null, preserveStoredAttempt: true }, h.deps);
    expect(result.attemptId).toBe(uuid(2));
    expect(h.calls.map((c) => `${c.action}:${c.sha256 ?? c.attemptId}`)).toEqual([`begin:${sha("a")}`, `begin:${sha("b")}`, `confirm:${uuid(2)}`]);
    expect(h.calls[0].requestId).not.toBe(h.calls[1].requestId);
    expect(h.stored()).toMatchObject({ sourceSha256: sha("b"), sha256: sha("b"), attemptId: uuid(2) });
  });

  it("resumes a legacy record (original bytes) with its request id first", async () => {
    const legacy = JSON.stringify({ sha256: sha("b"), requestId: uuid(90), attemptId: uuid(91) });
    const h = harness((body) => body.action === "begin" ? { attempt_id: uuid(91), state: "uploading", upload } : { ok: true }, legacy);
    await submitProof({ sourceSha256: sha("b"), candidates: [compressed, original], ticketNumber: null }, h.deps);
    expect(h.calls[0]).toMatchObject({ action: "begin", requestId: uuid(90), sha256: sha("b"), contentType: "image/png" });
    expect(h.calls.some((c) => c.action === "fail")).toBe(false);
    expect(h.uploads).toEqual(["b"]);
  });

  it("releases the stored attempt only for a different file while inscriptions are open", async () => {
    const other = JSON.stringify({ sourceSha256: sha("c"), sha256: sha("d"), requestId: uuid(80), attemptId: uuid(81) });
    const open = harness((body) => body.action === "begin" ? { attempt_id: uuid(3), state: "uploading", upload } : { ok: true }, other);
    await submitProof({ sourceSha256: sha("b"), candidates: [compressed, original], ticketNumber: null }, open.deps);
    expect(open.calls[0]).toEqual({ action: "fail", attemptId: uuid(81) });

    const closed = harness((body) => body.action === "begin" ? { attempt_id: uuid(3), state: "uploading", upload } : { ok: true }, other);
    await submitProof({ sourceSha256: sha("b"), candidates: [compressed, original], ticketNumber: null, preserveStoredAttempt: true }, closed.deps);
    expect(closed.calls.some((c) => c.action === "fail")).toBe(false);
  });

  it("reuses the same Blob for a replacement after UPLOAD_MISMATCH", async () => {
    let confirms = 0;
    const h = harness((body) => {
      if (body.action === "begin") return { attempt_id: uuid(confirms === 0 ? 4 : 5), state: "uploading", upload };
      if (body.action === "confirm" && confirms++ === 0) throw fail("UPLOAD_MISMATCH");
      return { ok: true };
    });
    const result = await submitProof({ sourceSha256: sha("b"), candidates: [compressed, original], ticketNumber: null }, h.deps);
    expect(h.calls.map((c) => c.action)).toEqual(["begin", "confirm", "fail", "begin", "confirm"]);
    expect(h.calls[0].sha256).toBe(h.calls[3].sha256);
    expect(h.calls[0].requestId).not.toBe(h.calls[3].requestId);
    expect(h.uploads).toEqual(["a", "a"]);
    expect(result.attemptId).toBe(uuid(5));
  });

  it("renews the request id once after UPLOAD_EXPIRED", async () => {
    let begins = 0;
    const h = harness((body) => {
      if (body.action === "begin" && begins++ === 0) throw fail("UPLOAD_EXPIRED");
      return body.action === "begin" ? { attempt_id: uuid(6), state: "confirmed" } : { ok: true };
    });
    await submitProof({ sourceSha256: sha("b"), candidates: [compressed, original], ticketNumber: null }, h.deps);
    expect(h.calls.map((c) => c.action)).toEqual(["begin", "begin"]);
    expect(h.calls[0].requestId).not.toBe(h.calls[1].requestId);
    expect(h.uploads).toEqual([]);
  });

  it("does not try other candidates for unrelated errors and reports the last error", async () => {
    const closed = harness(() => { throw fail("INSCRIPTIONS_CLOSED"); });
    await expect(submitProof({ sourceSha256: sha("b"), candidates: [compressed, original], ticketNumber: null }, closed.deps)).rejects.toMatchObject({ code: "INSCRIPTIONS_CLOSED" });
    expect(closed.calls).toHaveLength(1);

    const busy = harness(() => { throw fail("UPLOAD_IN_PROGRESS"); });
    await expect(submitProof({ sourceSha256: sha("b"), candidates: [compressed, original], ticketNumber: null }, busy.deps)).rejects.toMatchObject({ code: "UPLOAD_IN_PROGRESS" });
    expect(busy.calls).toHaveLength(2);
  });

  it("keeps working when sessionStorage throws", async () => {
    const h = harness((body) => body.action === "begin" ? { attempt_id: uuid(7), state: "confirmed" } : { ok: true });
    h.deps.readRecord = () => { throw new Error("denied"); };
    h.deps.writeRecord = () => { throw new Error("denied"); };
    await expect(submitProof({ sourceSha256: sha("b"), candidates: [compressed], ticketNumber: null }, h.deps)).resolves.toEqual({ attemptId: uuid(7), sha256: sha("a"), entryNumber: null });
  });
});
