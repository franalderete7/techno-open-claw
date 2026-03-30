create table if not exists public.brand_profiles (
  brand_key text primary key,
  label text not null,
  visual_direction text,
  theme_json jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.content_templates (
  id bigserial primary key,
  template_code text not null unique,
  label text not null,
  engine text not null check (engine in ('manual', 'orshot', 'runway')),
  channel text not null check (channel in ('feed', 'story', 'whatsapp', 'banner', 'comparison', 'trust_support', 'hero', 'other')),
  format text not null check (format in ('image', 'video', 'carousel', 'card', 'banner', 'story', 'mixed')),
  description text,
  prompt_text text,
  definition_json jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.product_content_profiles (
  product_id bigint primary key references public.products(id) on delete cascade,
  brand_key text not null references public.brand_profiles(brand_key) on delete restrict,
  tier text not null default 'other' check (tier in ('high', 'medium', 'low', 'other')),
  priority_level text not null default 'low' check (priority_level in ('low', 'medium', 'high')),
  compare_group_key text,
  hero_candidate boolean not null default false,
  content_enabled boolean not null default false,
  visual_mode text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists product_content_profiles_brand_tier_idx
  on public.product_content_profiles (brand_key, tier, priority_level, content_enabled);

create table if not exists public.media_assets (
  id bigserial primary key,
  product_id bigint references public.products(id) on delete set null,
  brand_key text references public.brand_profiles(brand_key) on delete set null,
  asset_type text not null check (
    asset_type in (
      'product_reference',
      'store_real',
      'delivery_real',
      'review_capture',
      'generated_static',
      'generated_video',
      'generated_story',
      'generated_whatsapp',
      'generated_banner',
      'other'
    )
  ),
  source_kind text not null check (source_kind in ('upload', 'catalog', 'telegram', 'manual', 'orshot', 'runway', 'meta', 'customer', 'store')),
  status text not null default 'draft' check (status in ('draft', 'approved', 'rejected', 'archived')),
  title text,
  storage_url text not null,
  mime_type text,
  width integer,
  height integer,
  duration_ms integer,
  external_asset_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists media_assets_product_idx on public.media_assets (product_id, created_at desc);
create index if not exists media_assets_brand_idx on public.media_assets (brand_key, created_at desc);
create index if not exists media_assets_status_idx on public.media_assets (status, created_at desc);
create index if not exists media_assets_type_idx on public.media_assets (asset_type, source_kind, created_at desc);

create table if not exists public.content_jobs (
  id bigserial primary key,
  product_id bigint references public.products(id) on delete set null,
  brand_key text references public.brand_profiles(brand_key) on delete set null,
  template_id bigint references public.content_templates(id) on delete set null,
  engine text not null check (engine in ('manual', 'orshot', 'runway')),
  channel text not null check (channel in ('feed', 'story', 'whatsapp', 'banner', 'comparison', 'trust_support', 'hero', 'other')),
  format text not null check (format in ('image', 'video', 'carousel', 'card', 'banner', 'story', 'mixed')),
  title text not null,
  status text not null default 'planned' check (
    status in ('planned', 'queued', 'generating', 'generated', 'review_required', 'approved', 'rejected', 'published', 'failed', 'cancelled')
  ),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high', 'urgent')),
  requested_by text,
  input_json jsonb not null default '{}'::jsonb,
  external_job_id text,
  external_status text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_jobs_status_idx on public.content_jobs (status, priority, created_at desc);
create index if not exists content_jobs_product_idx on public.content_jobs (product_id, created_at desc);
create index if not exists content_jobs_template_idx on public.content_jobs (template_id, created_at desc);

create table if not exists public.content_outputs (
  id bigserial primary key,
  job_id bigint not null references public.content_jobs(id) on delete cascade,
  asset_id bigint references public.media_assets(id) on delete set null,
  variant_key text,
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected', 'needs_changes')),
  review_notes text,
  output_url text,
  generation_payload jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_outputs_job_idx on public.content_outputs (job_id, created_at desc);
create index if not exists content_outputs_review_idx on public.content_outputs (review_status, created_at desc);

create table if not exists public.content_publications (
  id bigserial primary key,
  output_id bigint not null references public.content_outputs(id) on delete cascade,
  channel text not null check (channel in ('feed', 'story', 'whatsapp', 'banner', 'comparison', 'trust_support', 'hero', 'other')),
  target_account text,
  platform_post_id text,
  published_url text,
  status text not null default 'draft' check (status in ('draft', 'queued', 'published', 'failed', 'archived')),
  boost_candidate boolean not null default false,
  boosted boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists content_publications_status_idx on public.content_publications (status, published_at desc nulls last, created_at desc);
create index if not exists content_publications_output_idx on public.content_publications (output_id, created_at desc);

create table if not exists public.content_metrics (
  id bigserial primary key,
  publication_id bigint not null references public.content_publications(id) on delete cascade,
  snapshot_date date not null,
  impressions bigint,
  reach bigint,
  clicks bigint,
  spend numeric(12,2),
  engagement_rate numeric(12,4),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (publication_id, snapshot_date)
);

create index if not exists content_metrics_publication_date_idx
  on public.content_metrics (publication_id, snapshot_date desc);

drop trigger if exists brand_profiles_set_updated_at on public.brand_profiles;
create trigger brand_profiles_set_updated_at
before update on public.brand_profiles
for each row
execute function public.set_current_timestamp_updated_at();

drop trigger if exists content_templates_set_updated_at on public.content_templates;
create trigger content_templates_set_updated_at
before update on public.content_templates
for each row
execute function public.set_current_timestamp_updated_at();

drop trigger if exists product_content_profiles_set_updated_at on public.product_content_profiles;
create trigger product_content_profiles_set_updated_at
before update on public.product_content_profiles
for each row
execute function public.set_current_timestamp_updated_at();

drop trigger if exists media_assets_set_updated_at on public.media_assets;
create trigger media_assets_set_updated_at
before update on public.media_assets
for each row
execute function public.set_current_timestamp_updated_at();

drop trigger if exists content_jobs_set_updated_at on public.content_jobs;
create trigger content_jobs_set_updated_at
before update on public.content_jobs
for each row
execute function public.set_current_timestamp_updated_at();

drop trigger if exists content_outputs_set_updated_at on public.content_outputs;
create trigger content_outputs_set_updated_at
before update on public.content_outputs
for each row
execute function public.set_current_timestamp_updated_at();

drop trigger if exists content_publications_set_updated_at on public.content_publications;
create trigger content_publications_set_updated_at
before update on public.content_publications
for each row
execute function public.set_current_timestamp_updated_at();

insert into public.brand_profiles (brand_key, label, visual_direction, theme_json, active)
values
  (
    'samsung',
    'Samsung',
    'claridad tecnológica y decisión de compra',
    jsonb_build_object(
      'palette', jsonb_build_array('graphite', 'deep_blue', 'silver', 'technical_white'),
      'mood', 'orderly modern confidence',
      'notes', 'Modern but practical. High readability. Useful for commercial feed, stories and comparisons.',
      'preferred_channels', jsonb_build_array('feed', 'story', 'comparison', 'whatsapp'),
      'doc_alignment', 'clarity technology trust'
    ),
    true
  ),
  (
    'xiaomi_family',
    'Xiaomi / Redmi / Poco',
    'cámara, performance y personalidad',
    jsonb_build_object(
      'palette', jsonb_build_array('black', 'metal', 'high_contrast'),
      'mood', 'energetic premium technical',
      'notes', 'Dramatic but still realistic. Lens-forward visual language with controlled cinematic contrast.',
      'preferred_channels', jsonb_build_array('feed', 'story', 'comparison', 'whatsapp', 'hero'),
      'doc_alignment', 'camera power personality'
    ),
    true
  ),
  (
    'iphone',
    'iPhone',
    'premium sobrio y percepción de valor',
    jsonb_build_object(
      'palette', jsonb_build_array('deep_black', 'titanium_gray', 'soft_white', 'controlled_dark_blue'),
      'mood', 'quiet luxury',
      'notes', 'Minimal copy, generous negative space, elegant premium composition.',
      'preferred_channels', jsonb_build_array('feed', 'story', 'whatsapp', 'hero'),
      'doc_alignment', 'premium restrained minimal'
    ),
    true
  )
on conflict (brand_key) do update set
  label = excluded.label,
  visual_direction = excluded.visual_direction,
  theme_json = excluded.theme_json,
  active = excluded.active,
  updated_at = now();

insert into public.content_templates (
  template_code,
  label,
  engine,
  channel,
  format,
  description,
  prompt_text,
  definition_json,
  active
)
values
  (
    'TS_ORG_PRODUCT_BRAND_GAMMA_FEED_V1',
    'Commercial Product Feed',
    'orshot',
    'feed',
    'image',
    'Base commercial static for a model within a brand and tier.',
    'Create a clean and modern commercial smartphone visual for TechnoStore using the exact uploaded device reference. Maintain real proportions, camera layout and finish. Structured composition, refined lighting, strong readability zones, room for price, warranty and WhatsApp CTA. Keep the result useful for feed and later boost in Business Suite.',
    jsonb_build_object(
      'required_variables', jsonb_build_array('brand', 'gama', 'model_name', 'variant', 'storage', 'ram', 'price_cash_ars', 'warranty_text', 'cta_text'),
      'optional_variables', jsonb_build_array('color_name', 'price_installment_ars', 'promotion_tag', 'shipping_text', 'store_text', 'site_url'),
      'provider_template_id', null,
      'response_type', 'url',
      'response_format', 'png'
    ),
    true
  ),
  (
    'TS_ORG_MODEL_STORY_V1',
    'Model Story',
    'orshot',
    'story',
    'story',
    'Vertical story focused on one concrete model, one main benefit and direct CTA.',
    'Create a vertical story visual for TechnoStore focused on one exact smartphone model. Clean hierarchy, high readability, premium but practical look, clear product visibility, space for one key benefit, guarantee and WhatsApp call to action. Avoid visual clutter.',
    jsonb_build_object(
      'required_variables', jsonb_build_array('brand', 'gama', 'model_name', 'headline_text', 'feature_1', 'cta_text'),
      'optional_variables', jsonb_build_array('variant', 'storage', 'ram', 'price_cash_ars', 'warranty_text', 'shipping_text', 'cta_whatsapp_url'),
      'provider_template_id', null,
      'response_type', 'url',
      'response_format', 'png'
    ),
    true
  ),
  (
    'TS_WA_CARD_MODEL_V1',
    'WhatsApp Product Card',
    'orshot',
    'whatsapp',
    'card',
    'High-readability product card for sales conversations.',
    'Create a high-readability WhatsApp product card for TechnoStore. Use the exact device reference, prioritize clear hierarchy for model, price, guarantee, shipping and CTA. Fast scanning, clean product visibility, no decorative excess.',
    jsonb_build_object(
      'required_variables', jsonb_build_array('model_name', 'price_cash_ars', 'warranty_text', 'shipping_text', 'cta_text'),
      'optional_variables', jsonb_build_array('brand', 'gama', 'storage', 'ram', 'payment_text', 'store_text', 'cta_whatsapp_url'),
      'provider_template_id', null,
      'response_type', 'url',
      'response_format', 'png'
    ),
    true
  ),
  (
    'TS_COMPARE_PAIR_FEED_V1',
    'Pair Comparison Feed',
    'orshot',
    'comparison',
    'carousel',
    'Comparison piece for two nearby models in the same brand or tier.',
    'Create a clean comparison visual for TechnoStore that helps the buyer choose between two exact smartphone models. Preserve exact device references, create strong readability zones, keep the composition commercial and serious, and make the tradeoff between features easy to understand.',
    jsonb_build_object(
      'required_variables', jsonb_build_array('brand', 'gama', 'headline_text', 'feature_1', 'feature_2', 'feature_3'),
      'optional_variables', jsonb_build_array('site_url', 'cta_text', 'proof_social_asset_id'),
      'provider_template_id', null,
      'response_type', 'url',
      'response_format', 'png'
    ),
    true
  ),
  (
    'TS_TRUST_SUPPORT_V1',
    'Trust Support',
    'orshot',
    'trust_support',
    'card',
    'Support piece for trust and store credibility using delivery/review assets.',
    'Create a clean support visual for TechnoStore that reinforces trust without becoming the dominant narrative. Use a serious premium-commercial style, space for one delivery photo or one review screenshot if available, plus guarantee, shipping and store credibility cues.',
    jsonb_build_object(
      'required_variables', jsonb_build_array('warranty_text', 'shipping_text', 'store_text'),
      'optional_variables', jsonb_build_array('proof_social_asset_id', 'review_asset_id', 'cta_text'),
      'provider_template_id', null,
      'response_type', 'url',
      'response_format', 'png'
    ),
    true
  ),
  (
    'TS_HERO_MODEL_PREMIUM_V1',
    'Hero Premium',
    'runway',
    'hero',
    'video',
    'Selective premium hero for anchor products and boost candidates.',
    'Use the uploaded smartphone reference as the exact hero product. Keep all hardware details unchanged. Create a premium commercial scene with realistic materials, subtle reflections and controlled motion. No text overlays, no added accessories and no hardware modifications.',
    jsonb_build_object(
      'required_variables', jsonb_build_array('brand', 'gama', 'model_name'),
      'optional_variables', jsonb_build_array('headline_text', 'feature_1', 'feature_2', 'priority_level'),
      'runway_task_type', 'image_to_video',
      'runway_model', 'gen4_turbo',
      'ratio', '1280:720',
      'duration', 5
    ),
    true
  ),
  (
    'TS_SITE_BANNER_BRAND_V1',
    'Site Banner',
    'orshot',
    'banner',
    'banner',
    'Brand/category banner for storefront or landing modules.',
    'Create a clean brand banner for TechnoStore that preserves a clear commercial structure, premium readability and enough space for category-level copy. Keep the product exact and avoid distracting visual clutter.',
    jsonb_build_object(
      'required_variables', jsonb_build_array('brand', 'gama', 'headline_text'),
      'optional_variables', jsonb_build_array('feature_1', 'feature_2', 'feature_3', 'site_url'),
      'provider_template_id', null,
      'response_type', 'url',
      'response_format', 'png'
    ),
    true
  )
on conflict (template_code) do update set
  label = excluded.label,
  engine = excluded.engine,
  channel = excluded.channel,
  format = excluded.format,
  description = excluded.description,
  prompt_text = excluded.prompt_text,
  definition_json = excluded.definition_json,
  active = excluded.active,
  updated_at = now();
