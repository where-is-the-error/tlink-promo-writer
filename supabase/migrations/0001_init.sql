-- 개발명세서 3장 스키마 + API 구현에 필요한 보조 열·테이블.
-- 명세에 없는 추가분은 "-- [추가]"로 표시했다.
create extension if not exists vector;
create extension if not exists pg_trgm;

-- 자료와 쪽
create table materials (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source_file text not null,
  kind text not null check (kind in ('pdf','pptx_as_pdf')),
  page_count int not null,
  status text not null default 'scanning' check (status in ('scanning','ready','failed')), -- [추가] 검사 진행 상태
  status_detail text,                 -- [추가] 실패 사유
  storage_path text,                  -- [추가] 비공개 버킷 materials 안의 원본 PDF
  excluded_pages int[] not null default '{}', -- [추가] 등록하지 않는 쪽(대표 개인 연락처 등)
  created_at timestamptz default now()
);

create table material_pages (
  id uuid primary key default gen_random_uuid(),
  material_id uuid references materials(id) on delete cascade,
  page_no int not null,
  text text not null,
  embedding vector(1024),
  quarantined boolean default false,
  unique (material_id, page_no)
);
create index on material_pages using hnsw (embedding vector_cosine_ops);
create index on material_pages using gin (text gin_trgm_ops);

create table injection_findings (
  id uuid primary key default gen_random_uuid(),
  material_id uuid references materials(id) on delete cascade,
  page_no int not null,
  snippet text not null,
  detector text not null check (detector in ('invisible_text','instruction_like','hidden_slide')),
  status text not null default 'pending' check (status in ('pending','excluded','allowed')),
  created_at timestamptz default now()
);

create table guideline (
  id int primary key default 1,
  required_keywords text[] not null,
  title_phrases text[] not null,
  footer_lines text[] not null,
  image_order text[] not null,
  sections jsonb not null,
  missions jsonb not null,
  hashtags text[] not null
);

create table cards (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  claim text not null,
  benefit text not null,
  condition text,
  citations jsonb not null,
  priority_score real default 0,
  status text default 'active' check (status in ('active','archived')),
  created_at timestamptz default now()
);

-- [추가] 카드 생성 때 나온 자료 간 불일치([CONFLICT]) — 01 화면 경고용
create table card_conflicts (
  id uuid primary key default gen_random_uuid(),
  text text not null,
  created_at timestamptz default now()
);

create table posts (
  id uuid primary key default gen_random_uuid(),
  title text,
  memo text not null,
  status text not null default 'draft' check (status in ('draft','approved','published')),
  hashtags text[],
  omitted_missions jsonb default '[]',
  published_url text,
  rewrite_count int not null default 0,     -- [추가] 재작성은 글당 1회까지
  injection_notes jsonb not null default '[]', -- [추가] AI가 보고한 "데이터 속 지시문"
  is_eval boolean not null default false,   -- [추가] 평가 실행이 만든 글(목록·학습·중복 검사에서 제외)
  created_at timestamptz default now(),
  approved_at timestamptz,
  published_at timestamptz
);

create table photos (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references posts(id) on delete cascade,
  storage_path text not null,
  masked boolean not null default false,
  kind text check (kind in ('site','screen','scene')),
  screen_type text,
  description text,
  order_index int,
  created_at timestamptz default now()      -- [추가] 업로드 순서
);

create table photo_card_choices (
  post_id uuid references posts(id) on delete cascade,
  photo_id uuid references photos(id) on delete cascade,
  card_id uuid references cards(id),
  rank int not null,
  reason text,
  selected boolean default false,
  primary key (photo_id, card_id)
);

create table sentences (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references posts(id) on delete cascade,
  section_no int not null check (section_no between 1 and 5),
  order_no int not null,
  text text not null,
  source_type text not null check (source_type in ('card','photo','memo')),
  source_ref text not null,
  verdict text not null default 'pending'
    check (verdict in ('pending','match','exaggeration','unsupported')),
  verdict_reason text,
  evidence jsonb default '[]',
  suggestion text,
  deleted boolean default false
);

create table checklist_results (
  post_id uuid references posts(id) on delete cascade,
  item_key text not null,
  status text not null check (status in ('pass','fail','omitted')),
  checked_by text not null check (checked_by in ('code','ai')),
  detail text,
  primary key (post_id, item_key)
);

create table edits (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references posts(id) on delete cascade,
  sentence_id uuid references sentences(id) on delete set null, -- 재작성으로 문장이 지워져도 수정 기록은 남긴다
  kind text not null check (kind in ('edit','delete','card_swap')),
  before text, after text,
  created_at timestamptz default now()
);

create table reactions (
  post_id uuid primary key references posts(id) on delete cascade,
  views int, likes int, comments int, inquiries int,
  recorded_at timestamptz default now()
);

create table learned_rules (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('card_order','banned_phrase','preferred_intro')),
  value jsonb not null,
  evidence_count int not null,
  strength text not null check (strength in ('weak','ok')),
  active boolean default true,
  updated_at timestamptz default now()
);

create table eval_runs (
  id uuid primary key default gen_random_uuid(),
  results jsonb not null,
  page_accuracy real, trap_detected int, trap_total int,
  injection_detected int, injection_total int, avg_cost_usd real,
  created_at timestamptz default now()
);

-- [추가] 6-0: 모든 AI 호출 로그(08 화면 비용, 글 1건 비용 상한)
create table ai_calls (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references posts(id) on delete set null,
  purpose text not null,
  model text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  cost_usd real not null default 0,
  duration_ms int not null default 0,
  created_at timestamptz default now()
);
create index on ai_calls (post_id);

-- 3-1. 하이브리드 검색. 명세의 similarity(쪽 전체 vs 문장)는 긴 쪽에서 점수가 너무 낮아
-- word_similarity(문장이 쪽 안에 부분 일치하는 정도)로 바꿨다.
create or replace function match_pages(q_embedding vector(1024), q_text text, k int default 5)
returns table (page_id uuid, material_id uuid, page_no int, text text, score real)
language sql stable as $$
  with sem as (
    select id, row_number() over (order by embedding <=> q_embedding) as r
    from material_pages where not quarantined and embedding is not null
    order by embedding <=> q_embedding limit 20
  ),
  kw as (
    select id, row_number() over (order by word_similarity(q_text, text) desc) as r
    from material_pages where not quarantined and q_text <% text
    order by word_similarity(q_text, text) desc limit 20
  ),
  fused as (
    select id, sum(1.0 / (60 + r)) as score
    from (select * from sem union all select * from kw) u group by id
  )
  select p.id, p.material_id, p.page_no, p.text, f.score::real
  from fused f join material_pages p on p.id = f.id
  order by f.score desc limit k;
$$;

-- 3-2. 접근 제어: 서버는 service role로만 접근하고, 그 밖의 접근은 등록된 계정 1개만 허용한다.
create table app_owner (user_id uuid primary key);

do $$
declare t text;
begin
  foreach t in array array[
    'materials','material_pages','injection_findings','guideline','cards','card_conflicts',
    'posts','photos','photo_card_choices','sentences','checklist_results','edits',
    'reactions','learned_rules','eval_runs','ai_calls','app_owner'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format(
      'create policy owner_only on %I for all to authenticated
         using (auth.uid() in (select user_id from app_owner))
         with check (auth.uid() in (select user_id from app_owner))', t);
  end loop;
end $$;

-- 비공개 Storage 버킷
insert into storage.buckets (id, name, public)
values ('photos', 'photos', false), ('materials', 'materials', false)
on conflict (id) do nothing;
