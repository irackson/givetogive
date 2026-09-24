ALTER TABLE "givetogive_ask_contribution" ADD CONSTRAINT "ask_contribution_amount_check" CHECK ("givetogive_ask_contribution"."amount" > 0);--> statement-breakpoint
ALTER TABLE "givetogive_ask_contribution" ADD CONSTRAINT "ask_contribution_status_check" CHECK ("givetogive_ask_contribution"."status" IN ('pledged', 'completed', 'cancelled'));--> statement-breakpoint
ALTER TABLE "givetogive_ask" ADD CONSTRAINT "ask_currency_check" CHECK ("givetogive_ask"."type" <> 'money' OR "givetogive_ask"."currency" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "givetogive_ask" ADD CONSTRAINT "ask_difficulty_check" CHECK ("givetogive_ask"."difficulty" BETWEEN 1 AND 5);--> statement-breakpoint
ALTER TABLE "givetogive_ask" ADD CONSTRAINT "ask_goal_amount_check" CHECK ("givetogive_ask"."goal_amount" > 0);--> statement-breakpoint
ALTER TABLE "givetogive_ask" ADD CONSTRAINT "ask_status_check" CHECK ("givetogive_ask"."status" IN ('not_started', 'in_progress', 'complete'));--> statement-breakpoint
ALTER TABLE "givetogive_ask" ADD CONSTRAINT "ask_type_check" CHECK ("givetogive_ask"."type" IN ('time', 'task', 'item', 'money', 'resource'));--> statement-breakpoint
ALTER TABLE "givetogive_auth_rate_limit" ADD CONSTRAINT "auth_rate_limit_attempts_check" CHECK ("givetogive_auth_rate_limit"."attempts" >= 0);--> statement-breakpoint
ALTER TABLE "givetogive_auth_token" ADD CONSTRAINT "auth_token_purpose_check" CHECK ("givetogive_auth_token"."purpose" IN ('email_verification', 'password_reset'));