CREATE TABLE "givetogive_request_metric" (
	"environment" varchar(20) NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"procedure" varchar(100) NOT NULL,
	"outcome" varchar(16) NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"duration_sum_ms" bigint NOT NULL,
	"duration_max_ms" integer NOT NULL,
	CONSTRAINT "givetogive_request_metric_environment_bucket_start_procedure_outcome_pk" PRIMARY KEY("environment","bucket_start","procedure","outcome")
);
