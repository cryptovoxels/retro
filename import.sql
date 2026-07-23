-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS cube;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

--
-- PostgreSQL database dump
--

\restrict 1E3HS2ZB7p6NvmO7hluxfyBTsbymQYnEx3Go38eJIA9aDij3BqNg61rWfvvvw8g

-- Dumped from database version 18.4 (Homebrew)
-- Dumped by pg_dump version 18.4 (Homebrew)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- PostgreSQL database dump complete
--

\unrestrict 1E3HS2ZB7p6NvmO7hluxfyBTsbymQYnEx3Go38eJIA9aDij3BqNg61rWfvvvw8g

SET session_replication_role = 'replica';
BEGIN;

COPY public.islands FROM STDIN WITH (FORMAT CSV, HEADER);
\.

COPY public.properties FROM STDIN WITH (FORMAT CSV, HEADER);
\.

COPY public.womps FROM STDIN WITH (FORMAT CSV, HEADER);
\.

COPY public.avatars FROM STDIN WITH (FORMAT CSV, HEADER);
\.

COPY public.costumes FROM STDIN WITH (FORMAT CSV, HEADER);
\.

COPY public.wearables FROM STDIN WITH (FORMAT CSV, HEADER);
\.

COPY public.collections FROM STDIN WITH (FORMAT CSV, HEADER);
\.

COPY public.parcel_users FROM STDIN WITH (FORMAT CSV, HEADER);
\.

COPY public.asset_library FROM STDIN WITH (FORMAT CSV, HEADER);
