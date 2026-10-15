-- Installation entry point (see docs/DEPLOYMENT.md).
-- In Supabase SQL editor run schema-v1.sql, then migrations/002_student_workflow.sql,
-- then storage.sql. Existing v1 installs run ONLY the migration and storage.sql.
-- For psql users:
\ir schema-v1.sql
\ir migrations/002_student_workflow.sql
\ir migrations/003_course_automations.sql
\ir storage.sql
