-- Majority Loses Wedding Game
-- Paste into your Supabase SQL editor (safe to re-run — all CREATE OR REPLACE / IF NOT EXISTS)

create table if not exists wedding_guests (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  table_number int not null check (table_number between 1 and 9),
  penalty_points int not null default 0,
  created_at timestamptz default now()
);

create table if not exists wedding_game_state (
  id int primary key default 1,
  current_question_index int not null default 0,
  status text not null default 'waiting' check (status in ('waiting', 'voting', 'locked', 'results'))
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

-- Tracks which option was declared the loser per question (used to undo on override)
create table if not exists wedding_question_results (
  question_index int primary key,
  declared_option text not null,
  updated_at timestamptz default now()
);

-- Core RPC: declare a loser option for a question.
-- Safe to call multiple times — undoes previous penalties before applying new ones.
create or replace function set_question_result(q_index int, chosen_option text)
returns text
language plpgsql
as $$
declare
  prev_option text;
begin
  -- Find any previously declared result for this question
  select declared_option into prev_option
  from wedding_question_results
  where question_index = q_index;

  -- Undo previous penalties
  if prev_option is not null then
    update wedding_guests
    set penalty_points = greatest(0, penalty_points - 1)
    where id in (
      select guest_id from wedding_votes
      where question_index = q_index and selected_option = prev_option
    );
  end if;

  -- Apply new penalties
  update wedding_guests
  set penalty_points = penalty_points + 1
  where id in (
    select guest_id from wedding_votes
    where question_index = q_index and selected_option = chosen_option
  );

  -- Save / overwrite the declared result
  insert into wedding_question_results (question_index, declared_option, updated_at)
  values (q_index, chosen_option, now())
  on conflict (question_index) do update
    set declared_option = chosen_option, updated_at = now();

  return chosen_option;
end;
$$;

-- Convenience wrapper: auto-finds the majority and calls set_question_result
create or replace function calculate_majority_and_penalise(q_index int)
returns text
language plpgsql
as $$
declare
  majority_option text;
begin
  select selected_option into majority_option
  from wedding_votes
  where question_index = q_index
  group by selected_option
  order by count(*) desc
  limit 1;

  return set_question_result(q_index, majority_option);
end;
$$;

-- Questions table (editable from /host/setup UI)
create table if not exists wedding_questions (
  question_index int primary key,
  text text not null,
  options jsonb not null default '[]'
);

-- Enable Realtime (safe to re-run — ignores if already a member)
do $$ begin
  alter publication supabase_realtime add table wedding_game_state;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table wedding_votes;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table wedding_guests;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table wedding_question_results;
exception when others then null; end $$;
do $$ begin
  alter publication supabase_realtime add table wedding_questions;
exception when others then null; end $$;

-- Storage bucket for wedding images
-- Go to Supabase Dashboard > Storage > New bucket
-- Name: wedding-images, Public: ON
