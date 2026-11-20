/**
 * 로컬 실행용 저장소. Supabase 환경 변수가 없으면 db()가 이 구현을 돌려준다.
 * 이 프로젝트가 쓰는 supabase-js 호출(from/select/insert/update/upsert/delete, rpc, storage)만 흉내 낸다.
 * 데이터는 .local-data/db.json, 파일은 .local-data/storage/ 에 남는다(git 제외).
 */
import fs from "node:fs";
import path from "node:path";
import { GUIDELINE_SEED } from "./seed";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
interface Result {
  data: unknown;
  error: { message: string } | null;
}

const DIR = path.join(process.cwd(), ".local-data");
const DB_FILE = path.join(DIR, "db.json");
const STORAGE_DIR = path.join(DIR, "storage");
const holder = globalThis as { __tlinkLocalDb?: Tables };

function tables(): Tables {
  if (!holder.__tlinkLocalDb) {
    try {
      holder.__tlinkLocalDb = JSON.parse(fs.readFileSync(DB_FILE, "utf8")) as Tables;
    } catch {
      holder.__tlinkLocalDb = {};
    }
    if (!holder.__tlinkLocalDb.guideline?.length) holder.__tlinkLocalDb.guideline = [{ id: 1, ...GUIDELINE_SEED }];
  }
  return holder.__tlinkLocalDb;
}

function save() {
  fs.mkdirSync(DIR, { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(tables()));
  fs.renameSync(tmp, DB_FILE);
}

const now = () => new Date().toISOString();
const NO_ID = new Set(["photo_card_choices", "checklist_results", "reactions", "guideline", "app_owner"]);

/** 0001_init.sql의 열 기본값 */
const DEFAULTS: Record<string, () => Row> = {
  materials: () => ({ status: "scanning", status_detail: null, storage_path: null, excluded_pages: [] }),
  material_pages: () => ({ embedding: null, quarantined: false }),
  injection_findings: () => ({ status: "pending" }),
  cards: () => ({ condition: null, priority_score: 0, status: "active" }),
  posts: () => ({
    title: null, status: "draft", hashtags: null, omitted_missions: [], published_url: null,
    rewrite_count: 0, injection_notes: [], is_eval: false, approved_at: null, published_at: null,
  }),
  photos: () => ({ masked: false, kind: null, screen_type: null, description: null, order_index: null, file_name: null }),
  photo_card_choices: () => ({ reason: null, selected: false }),
  sentences: () => ({ verdict: "pending", verdict_reason: null, evidence: [], suggestion: null, deleted: false }),
  checklist_results: () => ({ detail: null }),
  edits: () => ({ sentence_id: null, before: null, after: null }),
  reactions: () => ({ recorded_at: now() }),
  learned_rules: () => ({ active: true, updated_at: now() }),
  ai_calls: () => ({ post_id: null, input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0, duration_ms: 0 }),
};

function withDefaults(table: string, row: Row): Row {
  return {
    ...(NO_ID.has(table) ? {} : { id: crypto.randomUUID() }),
    created_at: now(),
    ...(DEFAULTS[table]?.() ?? {}),
    ...row,
  };
}

/** select 문자열 안의 관계 조회("card:cards(*)", "reactions(*)") */
function embed(table: string, cols: string, row: Row): Row {
  const out = { ...row };
  for (const m of cols.matchAll(/(?:(\w+):)?(\w+)\(\*\)/g)) {
    const [, alias, target] = m;
    const all = tables()[target] ?? [];
    if (table === "photo_card_choices" && target === "cards") out[alias ?? target] = all.find((c) => c.id === row.card_id) ?? null;
    else if (table === "posts" && target === "reactions") out[alias ?? target] = all.find((r) => r.post_id === row.id) ?? null;
    else throw new Error(`로컬 저장소가 모르는 관계: ${table} → ${target}`);
  }
  return out;
}

class Query implements PromiseLike<Result> {
  private filters: ((r: Row) => boolean)[] = [];
  private orders: { key: string; asc: boolean; nullsFirst: boolean }[] = [];
  private max?: number;
  private op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
  private payload: Row | Row[] = [];
  private conflict: string[] = [];
  private returning = false;
  private mode: "many" | "single" | "maybe" = "many";
  private cols = "*";

  constructor(private table: string) {}

  select(cols = "*") {
    if (this.op !== "select") this.returning = true;
    this.cols = cols;
    return this;
  }
  insert(payload: Row | Row[]) {
    this.op = "insert";
    this.payload = payload;
    return this;
  }
  update(payload: Row) {
    this.op = "update";
    this.payload = payload;
    return this;
  }
  upsert(payload: Row | Row[], options: { onConflict?: string } = {}) {
    this.op = "upsert";
    this.payload = payload;
    this.conflict = (options.onConflict ?? "id").split(",").map((s) => s.trim());
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  eq(key: string, value: unknown) {
    this.filters.push((r) => r[key] === value);
    return this;
  }
  neq(key: string, value: unknown) {
    this.filters.push((r) => r[key] !== value);
    return this;
  }
  in(key: string, values: unknown[]) {
    this.filters.push((r) => values.includes(r[key]));
    return this;
  }
  not(key: string, operator: string, value: unknown) {
    if (operator !== "is" || value !== null) throw new Error("로컬 저장소는 not(col, 'is', null)만 지원합니다.");
    this.filters.push((r) => r[key] !== null && r[key] !== undefined);
    return this;
  }
  order(key: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}) {
    const asc = options.ascending ?? true;
    this.orders.push({ key, asc, nullsFirst: options.nullsFirst ?? !asc });
    return this;
  }
  limit(n: number) {
    this.max = n;
    return this;
  }
  single() {
    this.mode = "single";
    return this;
  }
  maybeSingle() {
    this.mode = "maybe";
    return this;
  }

  then<A = Result, B = never>(
    onOk?: ((value: Result) => A | PromiseLike<A>) | null,
    onFail?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    let result: Result;
    try {
      result = this.run();
    } catch (e) {
      result = { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
    }
    return Promise.resolve(result).then(onOk, onFail);
  }

  private matches(): Row[] {
    return (tables()[this.table] ?? []).filter((r) => this.filters.every((f) => f(r)));
  }

  private run(): Result {
    const db = tables();
    db[this.table] ??= [];
    let rows: Row[] = [];
    const list = (p: Row | Row[]) => (Array.isArray(p) ? p : [p]);

    if (this.op === "select") {
      rows = this.matches();
      for (const o of [...this.orders].reverse()) {
        rows = [...rows].sort((a, b) => {
          const x = a[o.key] as string | number | null | undefined;
          const y = b[o.key] as string | number | null | undefined;
          if (x == null || y == null) return x == null && y == null ? 0 : (x == null) === o.nullsFirst ? -1 : 1;
          return (x < y ? -1 : x > y ? 1 : 0) * (o.asc ? 1 : -1);
        });
      }
      if (this.max !== undefined) rows = rows.slice(0, this.max);
    } else if (this.op === "insert") {
      rows = list(this.payload).map((r) => withDefaults(this.table, r));
      db[this.table].push(...rows);
    } else if (this.op === "update") {
      rows = this.matches();
      for (const r of rows) Object.assign(r, this.payload);
    } else if (this.op === "upsert") {
      for (const item of list(this.payload)) {
        const existing = db[this.table].find((r) => this.conflict.every((k) => r[k] === item[k]));
        if (existing) rows.push(Object.assign(existing, item));
        else {
          const created = withDefaults(this.table, item);
          db[this.table].push(created);
          rows.push(created);
        }
      }
    } else {
      rows = this.matches();
      db[this.table] = db[this.table].filter((r) => !rows.includes(r));
    }

    if (this.op !== "select") {
      save();
      if (!this.returning) return { data: null, error: null };
    }
    const out = structuredClone(rows.map((r) => embed(this.table, this.cols, r)));
    if (this.mode === "single") {
      return out.length === 1 ? { data: out[0], error: null } : { data: null, error: { message: `행이 ${out.length}개입니다.` } };
    }
    if (this.mode === "maybe") return { data: out[0] ?? null, error: null };
    return { data: out, error: null };
  }
}

// ───────── rpc: match_pages(의미 검색 + 부분 일치, RRF) ─────────

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na * nb) || 1);
}

/** word_similarity 근사: 질의의 3글자 조각 중 쪽 원문에 들어 있는 비율 */
function partialMatch(query: string, text: string): number {
  const q = query.replace(/\s+/g, "");
  const t = text.replace(/\s+/g, "");
  if (q.length < 3) return 0;
  let hit = 0;
  for (let i = 0; i + 3 <= q.length; i++) if (t.includes(q.slice(i, i + 3))) hit++;
  return hit / (q.length - 2);
}

function matchPages(args: { q_embedding: string; q_text: string; k?: number }): Row[] {
  const query = JSON.parse(args.q_embedding) as number[];
  const pages = (tables().material_pages ?? []).filter((p) => !p.quarantined);
  const rank = (scored: { p: Row; s: number }[]) =>
    scored.sort((a, b) => b.s - a.s).slice(0, 20).map((x, i) => ({ p: x.p, r: i + 1 }));
  const sem = rank(
    pages.filter((p) => typeof p.embedding === "string").map((p) => ({ p, s: cosine(query, JSON.parse(p.embedding as string) as number[]) })),
  );
  const kw = rank(pages.map((p) => ({ p, s: partialMatch(args.q_text, String(p.text)) })).filter((x) => x.s >= 0.3));
  const fused = new Map<Row, number>();
  for (const x of [...sem, ...kw]) fused.set(x.p, (fused.get(x.p) ?? 0) + 1 / (60 + x.r));
  return [...fused]
    .sort((a, b) => b[1] - a[1])
    .slice(0, args.k ?? 5)
    .map(([p, score]) => ({ page_id: p.id, material_id: p.material_id, page_no: p.page_no, text: p.text, score }));
}

// ───────── storage ─────────

/** 버킷 안의 파일 경로(상위 폴더로 빠져나가는 경로는 거부) */
export function localFilePath(bucket: string, file: string): string {
  const root = path.join(STORAGE_DIR, bucket);
  const full = path.resolve(root, file);
  if (!full.startsWith(root + path.sep)) throw new Error("잘못된 파일 경로입니다.");
  return full;
}

function bucketApi(bucket: string) {
  return {
    async upload(file: string, bytes: Uint8Array, _options?: unknown) {
      try {
        const full = localFilePath(bucket, file);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, bytes);
        return { data: { path: file }, error: null };
      } catch (e) {
        return { data: null, error: { message: e instanceof Error ? e.message : String(e) } };
      }
    },
    async download(file: string) {
      try {
        return { data: new Blob([new Uint8Array(fs.readFileSync(localFilePath(bucket, file)))]), error: null };
      } catch {
        return { data: null, error: { message: "파일이 없습니다." } };
      }
    },
    async createSignedUrls(files: string[], _expiresIn: number) {
      return { data: files.map((f) => ({ signedUrl: `/api/local-files/${bucket}/${f}` })), error: null };
    },
  };
}

export const localClient = {
  from: (table: string) => new Query(table),
  rpc: async (name: string, args: unknown): Promise<Result> => {
    if (name !== "match_pages") return { data: null, error: { message: `로컬 저장소에 없는 함수: ${name}` } };
    return { data: matchPages(args as { q_embedding: string; q_text: string; k?: number }), error: null };
  },
  storage: { from: bucketApi },
};
