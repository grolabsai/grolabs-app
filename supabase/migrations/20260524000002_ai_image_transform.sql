-- AI image transforms — Replicate img2img prompts.
-- Lets the writer "restyle" an uploaded photo into the brand's
-- illustration_style + palette without leaving the editor.
--
-- Default model: stability-ai/sdxl. Supports img2img via `image` +
-- `prompt_strength`. Strength ~0.6 keeps composition while applying
-- the requested style. Swap via prompt_template for other models
-- (flux-dev img2img variants, recraft-ai/recraft-v3 for design
-- aesthetics, etc.) without a deploy.

insert into public.prompt_template (instance_id, key, label, description, template, variables, notes) values

(0, 'blog.image.transform.model',
 'AI image transform — Replicate model',
 'Replicate model identifier for image-to-image transforms.',
 'stability-ai/sdxl',
 '{}',
 'SDXL supports img2img via `image` + `prompt_strength`. Alternatives: lucataco/sdxl-img2img (dedicated img2img endpoint), black-forest-labs/flux-dev (newer, more aesthetic).'),

(0, 'blog.image.transform.restyle',
 'AI image transform — restyle prompt',
 'Prompt for the "Restyle in brand" transform. Asks the model to rewrite the input image in the brand''s illustration_style + palette, preserving composition.',
 E'Transform this image into a {{illustration_style}} illustration. Color palette: primary {{primary_color}}, background {{background_color}}, accent {{accent_color}}. Preserve the main composition and subject. Clean lines, no text, no watermarks.',
 '{illustration_style,primary_color,background_color,accent_color,text_color}',
 'prompt_strength is applied at call time (default 0.6). Lower values preserve more of the original; higher values allow more stylistic departure.'),

(0, 'blog.image.transform.recolor',
 'AI image transform — recolor prompt',
 'Prompt for the "Recolor to brand" transform. Keeps composition + subject style; shifts palette to brand colors.',
 E'Preserve the composition, subject, and overall style of this image. Shift the color palette to match: primary {{primary_color}}, background {{background_color}}, accent {{accent_color}}. Do not change what is depicted.',
 '{primary_color,background_color,accent_color}',
 'Recolor uses a lower prompt_strength (0.35) so composition stays intact. If colors don''t shift enough, raise it; if subject drifts, lower it.'),

(0, 'blog.image.transform.conceptualize',
 'AI image transform — conceptualize prompt',
 'Prompt for the "Conceptualize" transform. Rewrites a photo as a conceptual diagram-style illustration.',
 E'Reinterpret this image as a conceptual diagram or schematic illustration in the {{illustration_style}} style. Use simple shapes, brand colors (primary {{primary_color}}, accent {{accent_color}}, background {{background_color}}), and minimal detail. Convey the idea, not the photographic content.',
 '{illustration_style,primary_color,background_color,accent_color}',
 'Highest prompt_strength (0.75). Used for "make this look like an explainer diagram".')

on conflict (instance_id, key) do update
  set template = excluded.template,
      label = excluded.label,
      description = excluded.description,
      variables = excluded.variables,
      notes = excluded.notes;
