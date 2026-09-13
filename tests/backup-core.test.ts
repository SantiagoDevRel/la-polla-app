import { describe, expect, it } from "vitest";
import {
  backupAgeHours,
  backupStamp,
  buildRestoreSql,
  checkRestoreTarget,
  chunkRows,
  compareStorageCounts,
  compareStorageNames,
  displayPath,
  dollarQuote,
  fileEntry,
  FileManifest,
  isPartialBackupDir,
  listAllStorageObjects,
  parseMaxAgeHours,
  partialDirName,
  pickNewestBackup,
  quoteQualified,
  renderPolicySql,
  resolveManagementToken,
  sha256Hex,
  StorageEntry,
  verifyFileManifest,
} from "../scripts/backup/core";

describe("resolveManagementToken", () => {
  it("prefiere el token propio del backup, después el del proyecto y por último el PAT histórico", () => {
    expect(
      resolveManagementToken({ SUPABASE_BACKUP_PAT: "a", SUPABASE_ACCESS_TOKEN: "b", SUPABASE_30_DAYS: "c" }),
    ).toEqual({ token: "a", source: "SUPABASE_BACKUP_PAT" });
    expect(resolveManagementToken({ SUPABASE_ACCESS_TOKEN: "b", SUPABASE_30_DAYS: "c" })).toEqual({
      token: "b",
      source: "SUPABASE_ACCESS_TOKEN",
    });
    expect(resolveManagementToken({ SUPABASE_30_DAYS: "c" })).toEqual({ token: "c", source: "SUPABASE_30_DAYS" });
  });

  it("trata las variables vacías como ausentes", () => {
    expect(resolveManagementToken({ SUPABASE_BACKUP_PAT: "  ", SUPABASE_ACCESS_TOKEN: "", SUPABASE_30_DAYS: "c" }))
      .toEqual({ token: "c", source: "SUPABASE_30_DAYS" });
    expect(resolveManagementToken({})).toBeNull();
  });
});

describe("carpetas de backup", () => {
  it("genera el stamp en UTC al minuto y su variante .partial", () => {
    const stamp = backupStamp(new Date("2026-09-13T09:09:59.999Z"));
    expect(stamp).toBe("2026-09-13-09-09");
    expect(partialDirName(stamp)).toBe("2026-09-13-09-09.partial");
    expect(isPartialBackupDir("2026-09-13-09-09.partial")).toBe(true);
    expect(isPartialBackupDir("2026-09-13-09-09")).toBe(false);
  });

  it("elige el más nuevo ignorando exports sin terminar y carpetas ajenas", () => {
    expect(
      pickNewestBackup(["2026-07-26-21-30", "2026-09-13-12-02.partial", "2026-09-13-09-09", "notas", "2026-09-13-11-46"]),
    ).toBe("2026-09-13-11-46");
    expect(pickNewestBackup(["2026-09-13-12-02.partial"])).toBeNull();
    expect(pickNewestBackup([])).toBeNull();
  });

  it("calcula la antigüedad y valida MAX_AGE_HOURS", () => {
    expect(backupAgeHours("2026-09-13T06:00:00.000Z", new Date("2026-09-13T13:30:00.000Z"))).toBeCloseTo(7.5);
    expect(Number.isNaN(backupAgeHours("ayer", new Date()))).toBe(true);
    expect(parseMaxAgeHours(undefined)).toBeNull();
    expect(parseMaxAgeHours("")).toBeNull();
    expect(parseMaxAgeHours("7")).toBe(7);
    expect(() => parseMaxAgeHours("abc")).toThrow(/MAX_AGE_HOURS/);
    expect(() => parseMaxAgeHours("0")).toThrow(/MAX_AGE_HOURS/);
  });
});

/** Bucket simulado con la semántica de storage.list: carpetas sin id, a lo
 *  sumo `limit` entradas por llamada y paginación por offset. */
function fakeBucket(paths: string[]) {
  const calls: { prefix: string; limit: number; offset: number }[] = [];
  const list = async (prefix: string, page: { limit: number; offset: number }): Promise<StorageEntry[]> => {
    calls.push({ prefix, ...page });
    const base = prefix ? `${prefix}/` : "";
    const children = new Map<string, StorageEntry>();
    for (const p of paths) {
      if (!p.startsWith(base)) continue;
      const rest = p.slice(base.length);
      const [head, ...tail] = rest.split("/");
      if (tail.length) children.set(head, { name: head, id: null });
      else children.set(head, { name: head, id: `id-${p}` });
    }
    const sorted = Array.from(children.values()).sort((a, b) => a.name.localeCompare(b.name));
    return sorted.slice(page.offset, page.offset + page.limit);
  };
  return { list, calls };
}

describe("listAllStorageObjects", () => {
  it("pagina con offset en la raíz y dentro de carpetas, sin truncar pasado el límite", async () => {
    const root = Array.from({ length: 2500 }, (_, i) => `f${String(i).padStart(5, "0")}.jpg`);
    const nested = Array.from({ length: 1001 }, (_, i) => `casa/entrada/${String(i).padStart(5, "0")}.jpg`);
    const deep = ["casa/otra/sub/x.png", "casa/.emptyFolderPlaceholder"];
    const all = [...root, ...nested, ...deep];
    const { list, calls } = fakeBucket(all);

    const out = await listAllStorageObjects(list, "", 1000);

    expect(out).toHaveLength(all.length);
    expect(new Set(out)).toEqual(new Set(all));
    const rootOffsets = calls.filter((c) => c.prefix === "").map((c) => c.offset);
    expect(rootOffsets).toEqual([0, 1000, 2000]);
    const nestedOffsets = calls.filter((c) => c.prefix === "casa/entrada").map((c) => c.offset);
    expect(nestedOffsets).toEqual([0, 1000]);
  });

  it("pide una página más cuando la última queda exactamente llena", async () => {
    const { list, calls } = fakeBucket(Array.from({ length: 10 }, (_, i) => `a${i}`));
    const out = await listAllStorageObjects(list, "", 5);
    expect(out).toHaveLength(10);
    expect(calls.map((c) => c.offset)).toEqual([0, 5, 10]);
  });
});

describe("cruce de Storage contra storage.objects", () => {
  it("detecta conteos distintos y buckets de un solo lado", () => {
    expect(compareStorageCounts({ a: 3, b: 0 }, { a: 3 })).toEqual([]);
    const problems = compareStorageCounts({ a: 2, b: 1 }, { a: 3, c: 4 });
    expect(problems).toHaveLength(3);
    expect(problems.join("\n")).toMatch(/storage\/a: la API listó 2 objetos y storage.objects tiene 3/);
  });

  it("detecta repetidos y faltantes aunque el total cuadre, sin exponer nombres", () => {
    const problems = compareStorageNames({ a: ["x", "x", "y"] }, { a: ["x", "y", "z"] });
    expect(problems).toHaveLength(2);
    expect(problems.join("\n")).toMatch(/repitió 1/);
    expect(problems.join("\n")).toMatch(/1 objeto\(s\) de storage.objects no aparecieron/);
    expect(problems.join("\n")).not.toMatch(/"z"|\bz\b/);
    expect(compareStorageNames({ a: ["x"] }, { a: ["x"] })).toEqual([]);
  });
});

describe("manifiesto de archivos", () => {
  const files: Record<string, Buffer> = {
    "auth/users.full.json": Buffer.from("[1,2]"),
    "storage/payment-proofs/casa/8c1f2a4e-b6c3-49a1-9e80-12abcd34ef56.jpg": Buffer.from([0xff, 0xd8, 0xff, 0x00]),
    "schema/live/functions.sql": Buffer.from("select 1;"),
  };
  const manifest: FileManifest = Object.fromEntries(Object.entries(files).map(([k, v]) => [k, fileEntry(v)]));

  it("registra bytes y sha256", () => {
    expect(fileEntry("hola")).toEqual({ bytes: 4, sha256: sha256Hex("hola") });
    expect(fileEntry("ñ").bytes).toBe(2);
  });

  it("acepta una copia íntegra", async () => {
    const res = await verifyFileManifest(manifest, async (rel) => files[rel] ?? null, Object.keys(files));
    expect(res.problems).toEqual([]);
    expect(res.checked).toBe(3);
    expect(res.bytes).toBe(5 + 4 + 9);
  });

  it("reporta faltantes, cambios de bytes o de contenido y archivos sobrantes", async () => {
    const disk: Record<string, Buffer> = {
      "auth/users.full.json": Buffer.from("[1,3]"), // mismo tamaño, otro hash
      "schema/live/functions.sql": Buffer.from("select 12;"), // otro tamaño
      "schema/live/extra.txt": Buffer.from("x"),
    };
    const res = await verifyFileManifest(manifest, async (rel) => disk[rel] ?? null, Object.keys(disk));
    expect(res.checked).toBe(0);
    expect(res.problems).toHaveLength(4);
    const text = res.problems.join("\n");
    expect(text).toMatch(/auth\/users.full.json: sha256 no coincide/);
    expect(text).toMatch(/schema\/live\/functions.sql: 10 bytes, el manifiesto dice 9/);
    expect(text).toMatch(/FALTA en disco/);
    expect(text).toMatch(/schema\/live\/extra.txt: está en disco pero no en el manifiesto/);
    // Las rutas de Storage llevan ids: el mensaje las recorta.
    expect(text).not.toContain("8c1f2a4e-b6c3");
  });

  it("recorta solo las rutas de Storage", () => {
    expect(displayPath("storage/payment-proofs/casa/8c1f2a4e-b6c3-49a1-9e80-12abcd34ef56.jpg")).toBe(
      "storage/payment-proofs/…34ef56.jpg",
    );
    expect(displayPath("auth/users.full.json")).toBe("auth/users.full.json");
  });
});

describe("checkRestoreTarget", () => {
  it("permite Supabase local sin más", () => {
    for (const url of ["http://127.0.0.1:54321", "http://localhost:54321", "http://[::1]:54321"]) {
      expect(checkRestoreTarget(url, undefined)).toMatchObject({ ok: true, local: true });
    }
  });

  it("rechaza un host remoto sin ALLOW_REMOTE_TARGET o con un ref distinto", () => {
    const url = "https://exampleprojectref0001.supabase.co";
    const denied = checkRestoreTarget(url, undefined);
    expect(denied.ok).toBe(false);
    expect(denied.identity).toBe("exampleprojectref0001");
    expect(checkRestoreTarget(url, "otroref").ok).toBe(false);
    expect(checkRestoreTarget(url, "exampleprojectref000").ok).toBe(false);
    expect(checkRestoreTarget(url, "1").ok).toBe(false);
  });

  it("acepta un remoto solo con el ref exacto", () => {
    expect(checkRestoreTarget("https://abcdefghij.supabase.co", "abcdefghij")).toMatchObject({ ok: true, local: false });
    // Un host que no es *.supabase.co se nombra completo.
    expect(checkRestoreTarget("https://db.example.com", "db").ok).toBe(false);
    expect(checkRestoreTarget("https://db.example.com", "db.example.com").ok).toBe(true);
    // Un subdominio que imita localhost no es local.
    expect(checkRestoreTarget("https://localhost.evil.example", undefined).ok).toBe(false);
  });
});

describe("SQL de restore", () => {
  it("escoge una etiqueta de dollar-quoting que no aparece en el texto", () => {
    expect(dollarQuote("hola")).toBe("$lp0$hola$lp0$");
    expect(dollarQuote("a $lp0$ b $lp1$")).toBe("$lp2$a $lp0$ b $lp1$$lp2$");
  });

  it("cita identificadores calificados", () => {
    expect(quoteQualified("public.predictions")).toBe(`"public"."predictions"`);
    expect(quoteQualified(`public.raro"nombre`)).toBe(`"public"."raro""nombre"`);
    expect(() => quoteQualified("sinesquema")).toThrow();
  });

  it("parte lotes por filas y por tamaño", () => {
    const rows = Array.from({ length: 1203 }, (_, i) => ({ id: i }));
    expect(chunkRows(rows, 500, 1e9).map((c) => c.length)).toEqual([500, 500, 203]);
    const big = [{ t: "x".repeat(50) }, { t: "y".repeat(50) }, { t: "z" }];
    expect(chunkRows(big, 500, 80).map((c) => c.length)).toEqual([1, 2]);
    expect(chunkRows([], 500, 100)).toEqual([]);
  });

  it("envuelve todo en una transacción con triggers apagados, guarda y verificación", () => {
    const sql = buildRestoreSql({
      title: "prueba",
      sections: [
        { schemaTable: "auth.users", rows: [{ id: "u1", phone: "57300" }] },
        { schemaTable: "public.predictions", rows: Array.from({ length: 1001 }, (_, i) => ({ id: i })) },
        { schemaTable: "public.vacia", rows: [] },
      ],
    });
    const begin = sql.indexOf("BEGIN;");
    const replica = sql.indexOf("SET LOCAL session_replication_role = replica;");
    const commit = sql.lastIndexOf("COMMIT;");
    expect(begin).toBeGreaterThan(-1);
    expect(replica).toBeGreaterThan(begin);
    expect(commit).toBeGreaterThan(replica);
    expect(sql.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(sql).toContain("jsonb_populate_recordset");
    expect(sql).toContain("OVERRIDING SYSTEM VALUE");
    expect(sql).toContain("a.attgenerated = ''");
    // Guarda de destino vacío y conteo exacto para las tres tablas.
    expect(sql).toMatch(/public.vacia ya tiene % filas/);
    expect(sql).toMatch(/IF v_n <> 1001 THEN/);
    expect(sql).toMatch(/IF v_n <> 0 THEN/);
    // 1001 filas en lotes de 500 → 3 llamadas; auth → 1.
    expect(sql.match(/lp_restore_chunk\('"public"."predictions"'/g)).toHaveLength(3);
    expect(sql.match(/lp_restore_chunk\('"auth"."users"'/g)).toHaveLength(1);
    expect(sql).not.toMatch(/lp_restore_chunk\('"public"."vacia"'/);
    // Por defecto una columna desconocida aborta.
    expect(sql).toMatch(/::jsonb, false\) AS insertadas;/);
  });

  it("con ALLOW_NONEMPTY no pone guarda y compara con >=", () => {
    const sql = buildRestoreSql({
      title: "mezcla",
      sections: [{ schemaTable: "public.users", rows: [{ id: 1 }] }],
      allowNonEmpty: true,
      allowMissingColumns: true,
    });
    expect(sql).not.toContain("$guard$");
    expect(sql).toMatch(/IF v_n < 1 THEN/);
    expect(sql).toMatch(/::jsonb, true\) AS insertadas;/);
  });
});

describe("renderPolicySql", () => {
  it("arma CREATE POLICY con roles en arreglo o en texto de Postgres", () => {
    const base = {
      schemaname: "public",
      tablename: "casa_entries",
      policyname: "own rows",
      permissive: "PERMISSIVE",
      cmd: "SELECT",
      qual: "(user_id = auth.uid())",
      with_check: null,
    };
    expect(renderPolicySql({ ...base, roles: ["authenticated"] })).toBe(
      `CREATE POLICY "own rows" ON "public"."casa_entries" AS PERMISSIVE FOR SELECT TO authenticated USING ((user_id = auth.uid()));`,
    );
    expect(renderPolicySql({ ...base, roles: "{anon,authenticated}", cmd: "INSERT", qual: null, with_check: "true" })).toBe(
      `CREATE POLICY "own rows" ON "public"."casa_entries" AS PERMISSIVE FOR INSERT TO anon, authenticated WITH CHECK (true);`,
    );
  });
});
