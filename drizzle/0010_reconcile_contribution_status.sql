-- Pledges reserve capacity, but only delivered contributions complete an Ask.
UPDATE "givetogive_ask" AS a
SET "status" = CASE
  WHEN COALESCE(t.completed, 0) >= a.goal_amount THEN 'complete'
  WHEN COALESCE(t.active, 0) > 0 THEN 'in_progress'
  ELSE 'not_started'
END
FROM (
  SELECT a0.id,
    COALESCE(SUM(c.amount) FILTER (WHERE c.status = 'completed'), 0) AS completed,
    COALESCE(SUM(c.amount) FILTER (WHERE c.status IN ('pledged', 'completed')), 0) AS active
  FROM "givetogive_ask" a0
  LEFT JOIN "givetogive_ask_contribution" c ON c.ask_id = a0.id
  GROUP BY a0.id
) AS t
WHERE a.id = t.id;
