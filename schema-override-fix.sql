-- Fix apply_question_result:
-- 1. Add override_pick parameter (host override: only that option gets +2pts, all others 0)
-- 2. Fix mismatch between host page and RPC signature
-- Paste into Supabase SQL editor and run.

create or replace function apply_question_result(
  q_index       int,
  force_rank1   text    default null,   -- kept for backwards compat, unused
  override_pick text    default null    -- new: groom override — only this option gets +2pts
)
returns jsonb
language plpgsql as $$
declare
  prev_points   jsonb;
  ranked_opts   text[];
  new_points    jsonb := '{}'::jsonb;
  point_scale   int[] := array[-1, 0, 1, 2];
  i             int;
  pts           int;
  opt           text;
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

  -- Step 2a: OVERRIDE MODE — rank 1 pick gets +2pts, everyone else gets 0
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
    set penalty_points = g.penalty_points + (new_points->>(v.selected_option))::int
    from wedding_votes v
    where v.guest_id = g.id
      and v.question_index = q_index
      and new_points ? v.selected_option;

    insert into wedding_question_results (question_index, declared_option, option_points, updated_at)
    values (q_index, override_pick, new_points, now())
    on conflict (question_index) do update
      set declared_option = override_pick,
          option_points   = new_points,
          updated_at      = now();

    return new_points;
  end if;

  -- Step 2b: NORMAL MODE — rank by vote count
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
  set penalty_points = g.penalty_points + (new_points->>(v.selected_option))::int
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
