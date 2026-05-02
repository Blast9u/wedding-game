-- Run this in Supabase SQL editor to upgrade to ranked scoring
-- Safe to run on existing data

-- Add option_points column to track per-option adjustments (needed for clean undo)
alter table wedding_question_results
  add column if not exists option_points jsonb;

-- Drop old functions
drop function if exists set_question_result(int, text);
drop function if exists calculate_majority_and_penalise(int);
drop function if exists dictator_penalise(int, text);

-- New ranked scoring RPC
-- Rank 1 (most voted) = -1 pt, Rank 2 = 0 pt, Rank 3 = +1 pt, Rank 4 (least voted) = +2 pt
-- force_rank1: if set, that option is forced to rank 1 (host override)
create or replace function apply_question_result(q_index int, force_rank1 text default null)
returns jsonb
language plpgsql as $$
declare
  prev_points jsonb;
  ranked_opts text[];
  new_points  jsonb := '{}'::jsonb;
  point_scale int[] := array[-1, 0, 1, 2];
  i   int;
  pts int;
begin
  -- Step 1: Undo previous result for this question
  select option_points into prev_points
  from wedding_question_results where question_index = q_index;

  if prev_points is not null then
    update wedding_guests g
    set penalty_points = g.penalty_points - (prev_points->>(v.selected_option))::int
    from wedding_votes v
    where v.guest_id = g.id
      and v.question_index = q_index
      and prev_points ? v.selected_option;
  end if;

  -- Step 2: Rank options by vote count
  -- force_rank1 option is sorted to the top regardless of vote count
  select array_agg(selected_option order by
    (case when selected_option = force_rank1 then 1 else 0 end) desc,
    cnt desc,
    selected_option  -- stable tiebreak
  ) into ranked_opts
  from (
    select selected_option, count(*) as cnt
    from wedding_votes where question_index = q_index
    group by selected_option
  ) t;

  -- Step 3: Build points map {option: points}
  if ranked_opts is not null then
    for i in 1..array_length(ranked_opts, 1) loop
      pts := case when i <= 4 then point_scale[i] else 2 end;
      new_points := jsonb_set(new_points, array[ranked_opts[i]], to_jsonb(pts));
    end loop;
  end if;

  -- Step 4: Apply new points
  update wedding_guests g
  set penalty_points = g.penalty_points + (new_points->>(v.selected_option))::int
  from wedding_votes v
  where v.guest_id = g.id
    and v.question_index = q_index
    and new_points ? v.selected_option;

  -- Step 5: Save result
  insert into wedding_question_results (question_index, declared_option, option_points, updated_at)
  values (q_index, coalesce(ranked_opts[1], ''), new_points, now())
  on conflict (question_index) do update
    set declared_option = coalesce(ranked_opts[1], ''),
        option_points   = new_points,
        updated_at      = now();

  return new_points;
end;
$$;
