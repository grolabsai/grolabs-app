-- AI image generation — prompt + model rows for prompt_template.
-- Both editable via Supabase Studio (swap model, tune prompt) without
-- a deploy. Model identifier defaults to Replicate's Flux Schnell:
-- ~$0.003/image, 1-2s. Other tested options: black-forest-labs/flux-dev
-- (~$0.025, higher fidelity), stability-ai/stable-diffusion-3.5-large.

insert into public.prompt_template (instance_id, key, label, description, template, variables, notes) values
(0, 'blog.image.model',
 'AI image — Replicate model',
 'Replicate model identifier. Swap to try a different image model without a deploy.',
 'black-forest-labs/flux-schnell',
 '{}',
 'flux-schnell = fast + cheap (~$0.003/image, ~1-2s). Switch to flux-dev (~$0.025) for higher fidelity, or stability-ai/stable-diffusion-3.5-large for SD3.5.'),

(0, 'blog.image.prompt_template',
 'AI image — prompt template',
 'Wraps the writer''s short prompt with brand context (illustration_style + palette).',
 E'{{user_prompt}}. Style: {{illustration_style}}. Color palette: primary {{primary_color}}, background {{background_color}}, accent {{accent_color}}. Clean composition, no text, no watermarks.',
 '{user_prompt,illustration_style,primary_color,background_color,accent_color,text_color,body_font,heading_font,display_name}',
 'Available variables come from brand_system. Edit to change how brand context gets injected into every image prompt. Avoid promising things the model cannot reliably deliver (specific text, exact hex matching).')
on conflict (instance_id, key) do update
  set template = excluded.template,
      label = excluded.label,
      description = excluded.description,
      variables = excluded.variables,
      notes = excluded.notes;
