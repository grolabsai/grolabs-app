-- Blog AI — move prompts out of code into the DB.
--
-- Principle (locked in PR conversation): anything loaded into an agent
-- lives in a queryable row, not a string constant. Edit via Supabase
-- Studio without a deploy. See docs/policy/blog.md §AI.
--
-- Resolution order at runtime: the writer's own instance_id wins; if
-- they have no override, instance 0 (GroLabs template) is the fallback.
-- This is the funnel-style "tenant_read with template fallthrough"
-- pattern — same shape, different table.

create table public.prompt_template (
  prompt_template_id bigserial primary key,
  instance_id bigint not null references public.instance(instance_id) on delete cascade,
  key text not null,
  label text not null,
  description text,
  template text not null,
  variables text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index prompt_template_instance_key_unique
  on public.prompt_template (instance_id, key);

create trigger prompt_template_set_updated_at
  before update on public.prompt_template
  for each row execute function public.set_updated_at();

alter table public.prompt_template enable row level security;

-- Read: any authenticated user can read templates from their own instance
-- or from the GroLabs template instance (instance 0). The fallthrough is
-- what makes "use the canonical prompt unless you've overridden it" work.
create policy prompt_template_read on public.prompt_template
  for select to authenticated
  using (
    instance_id = 0
    or exists (
      select 1 from public.instance_member im
      where im.instance_id = prompt_template.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
    )
  );

-- Write: members can mutate only their own instance's rows. Instance 0
-- (GroLabs template) is editable only by GroLabs members.
create policy prompt_template_member_write on public.prompt_template
  for all to authenticated
  using (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = prompt_template.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
    )
  )
  with check (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = prompt_template.instance_id
        and im.user_id = auth.uid()
        and im.is_active = true
    )
  );

grant select on public.prompt_template to authenticated;
grant insert, update, delete on public.prompt_template to authenticated;
grant usage, select on sequence public.prompt_template_prompt_template_id_seq to authenticated;

-- Seed instance 0 (GroLabs template) with the canonical blog prompts that
-- were previously hardcoded in src/lib/ai/blog.ts.

insert into public.prompt_template (instance_id, key, label, description, template, variables, notes) values

(0, 'blog.voice_default',
 'Default voice guide',
 'Embedded into the system prompt of every blog AI call. Sets tone, what to avoid, what to prefer. Edit to change the agent''s house voice.',
 E'Tone: clear, direct, no fluff. Sentence-level concrete.\nAvoid: marketing-speak, hedging ("perhaps", "might be worth"), filler intros ("In today''s fast-paced…").\nPrefer: concrete examples over abstractions; short paragraphs; second-person ("you") over first-person plural ("we").',
 '{}',
 'When per-post writing_strategy.voice_guide lands (consulting agent PR), this is the fallback when no per-post voice is set.'),

(0, 'blog.system_prompt',
 'System prompt template',
 'The system message used on every blog AI call. {{voice_guide}} is substituted from blog.voice_default (or the per-post override when that ships).',
 E'You are an editor helping a writer publish posts on their blog. {{voice_guide}}\n\nOutput exactly what the user asked for and nothing else. No preamble like "Here''s…" or "Here are some options:". No closing meta-commentary. Match the language of the post (Spanish/English) automatically from context.',
 '{voice_guide}',
 NULL),

(0, 'blog.suggest_titles',
 'Suggest titles (user prompt)',
 'Asks the model for 3 title options. The sidebar dialog shows them as click-to-apply chips.',
 E'Suggest 3 candidate titles for the post below. Output exactly 3 lines, one title per line. No numbering, no quotes, no commentary.\n\n{{post_context}}',
 '{post_context}',
 'Tighter prompts → tighter titles. Avoid asking for "creative" or "catchy" here — those words push the model toward listicle-bait.'),

(0, 'blog.generate_summary',
 'Generate summary (user prompt)',
 'Asks for a single SEO meta description. The result fills the post''s summary field directly.',
 E'Write a single SEO meta description for the post below. 1–2 sentences, aim for ~155 characters, never exceed 200. State what the reader learns and why it matters. Output only the description.\n\n{{post_context}}',
 '{post_context}',
 'The 155-char target is the Google SERP truncation point on desktop.'),

(0, 'blog.continue_writing',
 'Continue writing (user prompt)',
 'Asks the model to extend the post from where it ends. Result appended as paragraphs in Tiptap.',
 E'Continue the post below from where it ends. Write 1–2 paragraphs (~120 words) that extend the line of thought naturally. Do not summarize what was already said. Do not start with a transitional phrase like "Furthermore" or "Additionally". Just keep writing.\n\n{{post_context}}',
 '{post_context}',
 NULL),

(0, 'blog.rewrite.template',
 'Rewrite selection (wrapper prompt)',
 'The user prompt wrapping all 6 rewrite variants. {{instruction}} comes from one of the six blog.rewrite.instruction.* rows below.',
 E'Rewrite the SELECTION below. {{instruction}}\n\nOutput only the rewritten text — no quotes, no preamble, no commentary. Match the original language.\n\nSELECTION:\n{{selection}}{{surrounding_context}}',
 '{instruction,selection,surrounding_context}',
 'surrounding_context is empty string OR a "\n\nFor context, the surrounding post is:\n…" block.'),

(0, 'blog.rewrite.instruction.shorter',
 'Rewrite: shorter',
 'Per-variant instruction interpolated into blog.rewrite.template.',
 'Make it shorter and tighter without losing meaning. Cut filler.',
 '{}',
 NULL),

(0, 'blog.rewrite.instruction.longer',
 'Rewrite: longer',
 'Per-variant instruction interpolated into blog.rewrite.template.',
 'Expand it with one concrete example or specific detail. Don''t pad.',
 '{}',
 NULL),

(0, 'blog.rewrite.instruction.clearer',
 'Rewrite: clearer',
 'Per-variant instruction interpolated into blog.rewrite.template.',
 'Rewrite for maximum clarity. Replace abstractions with concrete language. Keep the same meaning.',
 '{}',
 NULL),

(0, 'blog.rewrite.instruction.formal',
 'Rewrite: more formal',
 'Per-variant instruction interpolated into blog.rewrite.template.',
 'Rewrite in a more formal, professional register.',
 '{}',
 NULL),

(0, 'blog.rewrite.instruction.casual',
 'Rewrite: more casual',
 'Per-variant instruction interpolated into blog.rewrite.template.',
 'Rewrite in a more conversational, casual register.',
 '{}',
 NULL),

(0, 'blog.rewrite.instruction.grammar',
 'Rewrite: fix grammar',
 'Per-variant instruction interpolated into blog.rewrite.template.',
 'Fix grammar, spelling, and punctuation. Keep the voice and structure intact. Don''t rewrite for style.',
 '{}',
 NULL);
