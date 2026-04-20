-- Keep customers, conversations, messages, and settings (key/value JSON for store config, etc.).
-- Drops catalog, storefront, orders, audit, and content tables.

drop table if exists public.conversation_review_items cascade;
drop table if exists public.conversation_review_batches cascade;
drop table if exists public.content_metrics cascade;
drop table if exists public.content_publications cascade;
drop table if exists public.content_outputs cascade;
drop table if exists public.content_jobs cascade;
drop table if exists public.media_assets cascade;
drop table if exists public.product_content_profiles cascade;
drop table if exists public.content_templates cascade;
drop table if exists public.brand_profiles cascade;
drop table if exists public.storefront_events cascade;
drop table if exists public.inventory_purchase_funders cascade;
drop table if exists public.inventory_purchases cascade;
drop table if exists public.storefront_checkout_intents cascade;
drop table if exists public.operator_confirmations cascade;
drop table if exists public.order_items cascade;
drop table if exists public.orders cascade;
drop table if exists public.stock_units cascade;
drop table if exists public.products cascade;
drop table if exists public.audit_logs cascade;
