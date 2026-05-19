# Wedding Game — Deployment Guide

**"I wanna be the very BEST, Like no one EVER WAS"**
A majority-loses party game for weddings. Guests vote on image questions; the most popular answer loses points. Be unique, win prizes.

---

## How the Game Works

- Guests scan a QR code → join with name + table number
- Host controls the game from `/host`
- Projector shows questions + live vote tracker at `/projector`
- Each round: most votes = −1pt, 2nd = 0pt, 3rd = +1pt, least votes = +2pt
- Higher score = more unique = winner
- Host can trigger **Groom Override** after any round — picks one option to penalise (+2pt), all others get 0pt
- Ending screen shows individual podium (top 30) + Hall of Shame table

---

## Stack

- **Frontend:** Next.js (App Router) + TypeScript + Tailwind CSS
- **Database:** Supabase (Postgres + Realtime + Storage)
- **Hosting:** Vercel

---

## 1. Supabase Setup

### Create a new Supabase project

Go to [supabase.com](https://supabase.com) → New project.

### Run the schema

Paste and run `schema.sql` in **SQL Editor → New query**, then run `schema-ranked-scoring.sql`, then run `schema-override-fix.sql` in that order.

Or run this combined migration:

```sql
-- Tables
create table if not exists wedding_guests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  table_number int not null check (table_number between 1 and 15),
  score int not null default 0,
  created_at timestamptz default now()
);

create table if not exists wedding_game_state (
  id int primary key default 1,
  current_question_index int not null default 0,
  status text not null default 'waiting'
    check (status in ('waiting', 'voting', 'locked', 'results', 'override'))
);

insert into wedding_game_state (id, current_question_index, status)
values (1, 0, 'waiting')
on conflict (id) do nothing;

create table if not exists wedding_votes (
  id uuid primary key default gen_random_uuid(),
  guest_id uuid not null references wedding_guests(id) on delete cascade,
  question_index int not null,
  selected_option text not null,
  created_at timestamptz default now(),
  unique (guest_id, question_index)
);

create table if not exists wedding_question_results (
  question_index int primary key,
  declared_option text not null,
  option_points jsonb,
  updated_at timestamptz default now()
);

create table if not exists wedding_questions (
  question_index int primary key,
  text text not null,
  options jsonb not null default '[]'
);

-- Realtime
do $$ begin alter publication supabase_realtime add table wedding_game_state; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table wedding_votes; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table wedding_guests; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table wedding_question_results; exception when others then null; end $$;
do $$ begin alter publication supabase_realtime add table wedding_questions; exception when others then null; end $$;

-- Scoring RPC
create or replace function apply_question_result(
  q_index       int,
  override_pick text default null
)
returns jsonb
language plpgsql as $$
declare
  prev_points  jsonb;
  ranked_opts  text[];
  new_points   jsonb := '{}'::jsonb;
  point_scale  int[] := array[-1, 0, 1, 2];
  i            int;
  pts          int;
  opt          text;
begin
  select option_points into prev_points
  from wedding_question_results where question_index = q_index;

  if prev_points is not null then
    update wedding_guests g
    set score = g.score - (prev_points->>(v.selected_option))::int
    from wedding_votes v
    where v.guest_id = g.id
      and v.question_index = q_index
      and prev_points ? v.selected_option;
  end if;

  if override_pick is not null then
    select array_agg(distinct selected_option) into ranked_opts
    from wedding_votes where question_index = q_index;

    if ranked_opts is not null then
      foreach opt in array ranked_opts loop
        pts := case when opt = override_pick then 2 else 0 end;
        new_points := jsonb_set(new_points, array[opt], to_jsonb(pts));
      end loop;
    end if;

    update wedding_guests g
    set score = g.score + (new_points->>(v.selected_option))::int
    from wedding_votes v
    where v.guest_id = g.id
      and v.question_index = q_index
      and new_points ? v.selected_option;

    insert into wedding_question_results (question_index, declared_option, option_points, updated_at)
    values (q_index, override_pick, new_points, now())
    on conflict (question_index) do update
      set declared_option = override_pick, option_points = new_points, updated_at = now();

    return new_points;
  end if;

  select array_agg(selected_option order by cnt desc, selected_option)
  into ranked_opts
  from (
    select selected_option, count(*) as cnt
    from wedding_votes where question_index = q_index
    group by selected_option
  ) t;

  if ranked_opts is not null then
    for i in 1..array_length(ranked_opts, 1) loop
      pts := case when i <= 4 then point_scale[i] else 2 end;
      new_points := jsonb_set(new_points, array[ranked_opts[i]], to_jsonb(pts));
    end loop;
  end if;

  update wedding_guests g
  set score = g.score + (new_points->>(v.selected_option))::int
  from wedding_votes v
  where v.guest_id = g.id
    and v.question_index = q_index
    and new_points ? v.selected_option;

  insert into wedding_question_results (question_index, declared_option, option_points, updated_at)
  values (q_index, coalesce(ranked_opts[1], ''), new_points, now())
  on conflict (question_index) do update
    set declared_option = coalesce(ranked_opts[1], ''),
        option_points   = new_points,
        updated_at      = now();

  return new_points;
end;
$$;
```

### RLS policies

In **Supabase → Authentication → Policies**, for each wedding table enable **anon** access:
- `wedding_guests` — INSERT, SELECT, UPDATE
- `wedding_game_state` — SELECT
- `wedding_votes` — INSERT, SELECT
- `wedding_question_results` — SELECT
- `wedding_questions` — SELECT

Or run:

```sql
alter table wedding_guests enable row level security;
alter table wedding_game_state enable row level security;
alter table wedding_votes enable row level security;
alter table wedding_question_results enable row level security;
alter table wedding_questions enable row level security;

create policy "anon all" on wedding_guests for all to anon using (true) with check (true);
create policy "anon read" on wedding_game_state for select to anon using (true);
create policy "anon all" on wedding_votes for all to anon using (true) with check (true);
create policy "anon read" on wedding_question_results for select to anon using (true);
create policy "anon read" on wedding_questions for select to anon using (true);
```

### Storage bucket

Go to **Supabase → Storage → New bucket**
- Name: `wedding-images`
- Public: **ON**

---

## 2. Environment Variables

Create `.env.local` in the project root:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_SITE_URL=https://your-vercel-url.vercel.app
```

Get the URL and anon key from **Supabase → Project Settings → API**.

`NEXT_PUBLIC_SITE_URL` is the full URL of the deployed app — used to generate the guest QR code on the projector screen. No trailing slash.

---

## 3. Deploy to Vercel

1. Push repo to GitHub
2. Import project in [vercel.com](https://vercel.com)
3. Add the three environment variables above in **Vercel → Project → Settings → Environment Variables**
4. Deploy

---

## 4. Set Up Questions

Go to `/host/setup` and:
- Add questions (text + up to 4 options each)
- Upload images for each option (optional — coloured boxes shown if no image)
- Drag to reorder
- Hit **Save All**

---

## 5. Running the Game

| URL | Who uses it |
|-----|-------------|
| `/projector` | Display on big screen / TV |
| `/host` | Host's phone or laptop |
| `/guest` | Guests (via QR code) |
| `/host/setup` | Before the event — add questions + images |

**Flow per round:**
1. Host: **Start Game / Next Question**
2. Guests vote on their phones (10s countdown on projector)
3. Host: **Lock Voting**
4. Host: **Calculate Majority & Show Results**
5. *(Optional)* Host: **Groom Override** → pick the option to penalise → Apply
6. Repeat from step 1

**Reset:** Host dashboard → **Reset Game** — clears all guests, votes, and scores.

---

## 6. Teardown (after event)

Run in Supabase SQL editor:

```sql
drop function if exists apply_question_result(integer, text);
drop function if exists apply_question_result(integer);
drop table if exists wedding_question_results;
drop table if exists wedding_votes;
drop table if exists wedding_guests;
drop table if exists wedding_questions;
drop table if exists wedding_game_state;
```

Delete the `wedding-images` storage bucket manually in Supabase → Storage.

Pause or delete the Supabase project if not reusing it.
