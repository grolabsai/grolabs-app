-- Prospectos v3 — per-vertical detection keywords + expected attributes.
--
-- Two additions to support smarter runs:
--
-- 1. vertical.detection_keywords — when the user doesn't pick a vertical
--    on the run form, the runner classifies the prospect from its
--    homepage. Layer 1 is a keyword score using this column (free,
--    deterministic). Layer 2 (Claude Haiku) is the LLM tie-breaker.
--
-- 2. vertical_expected_attribute — the catalog of attributes a
--    well-merchandised PDP in this vertical should expose. Powers the
--    returns.attribute_completeness scorer: matches keywords against
--    the PDP description + product_schema_fields and computes coverage.
--    Per-instance + instance-0 fallthrough (prompt_template pattern).

alter table public.vertical
  add column if not exists detection_keywords text[] not null default '{}';

update public.vertical set detection_keywords = '{dog,cat,pet,puppy,kitten,perro,gato,mascota,cachorro,gatito,kibble,alimento balanceado,pet food,veterinary,veterinario,leash,collar,litter,arena,treat,golosina,paws,fauna,canine,felino}'
  where vertical_code = 'pet_retail';

update public.vertical set detection_keywords = '{dress,shirt,pants,shoes,blouse,skirt,jeans,t-shirt,vestido,camisa,pantalon,zapato,zapatilla,blusa,falda,size guide,guia de tallas,fitting,fit,xs,xl,outfit,apparel,clothing,ropa,fashion,moda}'
  where vertical_code = 'fashion';

update public.vertical set detection_keywords = '{laptop,smartphone,tablet,camera,speaker,headphone,monitor,keyboard,mouse,charger,cable,battery,bateria,celular,cargador,auriculares,parlante,gigabytes,gb,ram,resolution,megapixel,bluetooth,wifi,usb,hdmi}'
  where vertical_code = 'electronics';

update public.vertical set detection_keywords = '{sofa,chair,table,bed,mattress,lamp,desk,shelf,plant,garden,muebles,silla,mesa,cama,colchon,lampara,escritorio,estante,jardin,decor,furniture,home goods,outdoor}'
  where vertical_code = 'home_garden';

update public.vertical set detection_keywords = '{lipstick,mascara,foundation,serum,moisturizer,cream,perfume,fragrance,shampoo,labial,base,crema,hidratante,perfume,fragancia,champu,acabado mate,spf,ml,fl oz,piel,skin}'
  where vertical_code = 'beauty';

update public.vertical set detection_keywords = '{grocery,produce,bakery,dairy,beverage,snack,frozen,organic,fresh,supermercado,abarrotes,panaderia,lacteos,bebida,snack,congelado,organico,fresco,kg,litro,l,unidad,oferta}'
  where vertical_code = 'grocery';

create table public.vertical_expected_attribute (
  expected_attr_id bigserial primary key,
  instance_id bigint not null references public.instance(instance_id) on delete cascade,
  vertical_id bigint not null references public.vertical(vertical_id) on delete cascade,
  attribute_code text not null,
  label text not null,
  match_keywords text[] not null default '{}',
  weight numeric(3,2) not null default 1.00,
  locale text not null default 'es',
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index vertical_expected_attribute_unique
  on public.vertical_expected_attribute (instance_id, vertical_id, locale, attribute_code);

create trigger vertical_expected_attribute_set_updated_at
  before update on public.vertical_expected_attribute
  for each row execute function public.set_updated_at();

alter table public.vertical_expected_attribute enable row level security;

create policy vertical_expected_attribute_read on public.vertical_expected_attribute
  for select to authenticated using (
    instance_id = 0 or exists (
      select 1 from public.instance_member im
      where im.instance_id = vertical_expected_attribute.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  );

create policy vertical_expected_attribute_write on public.vertical_expected_attribute
  for all to authenticated using (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = vertical_expected_attribute.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  ) with check (
    exists (
      select 1 from public.instance_member im
      where im.instance_id = vertical_expected_attribute.instance_id
        and im.user_id = auth.uid() and im.is_active = true
    )
  );

create policy vertical_expected_attribute_anon_template on public.vertical_expected_attribute
  for select to anon using (instance_id = 0);

grant select, insert, update, delete on public.vertical_expected_attribute to authenticated;
grant select on public.vertical_expected_attribute to anon;
grant usage, select on sequence public.vertical_expected_attribute_expected_attr_id_seq to authenticated;

do $$
declare
  v_pet bigint; v_fashion bigint; v_electronics bigint;
begin
  select vertical_id into v_pet         from public.vertical where vertical_code = 'pet_retail';
  select vertical_id into v_fashion     from public.vertical where vertical_code = 'fashion';
  select vertical_id into v_electronics from public.vertical where vertical_code = 'electronics';

  insert into public.vertical_expected_attribute
    (instance_id, vertical_id, attribute_code, label, match_keywords, weight, locale) values
  (0, v_pet, 'weight',       'Peso / pack size',  ARRAY['kg','gr','gramos','peso','kilos','lb','oz','pounds','grams','weight'],         1.0, 'es'),
  (0, v_pet, 'ingredients',  'Ingredientes',      ARRAY['ingredientes','ingredient','contains','formula','composicion','nutrition'],    1.0, 'es'),
  (0, v_pet, 'life_stage',   'Etapa de vida',     ARRAY['cachorro','adulto','senior','puppy','adult','senior','life stage','etapa'],     0.8, 'es'),
  (0, v_pet, 'breed_size',   'Tamaño de raza',    ARRAY['raza pequeña','raza grande','small breed','large breed','toy','medium'],        0.7, 'es'),
  (0, v_pet, 'brand',        'Marca',             ARRAY['marca','brand','manufacturer','fabricante'],                                     0.5, 'es'),
  (0, v_fashion, 'size',     'Talla',             ARRAY['talla','size','xs','xl','xxl','small','medium','large','chico','grande'],       1.0, 'es'),
  (0, v_fashion, 'color',    'Color',             ARRAY['color','colour','colors','colores'],                                              1.0, 'es'),
  (0, v_fashion, 'material', 'Material / tela',   ARRAY['material','fabric','tela','algodon','cotton','poliester','polyester','wool'],   0.9, 'es'),
  (0, v_fashion, 'fit',      'Calce',             ARRAY['calce','fit','slim','regular','oversized','holgado','ajustado'],                 0.7, 'es'),
  (0, v_fashion, 'care',     'Cuidado',           ARRAY['cuidado','care','wash','lavado','dry clean','tintoreria','iron','plancha'],     0.5, 'es'),
  (0, v_electronics, 'model_number',  'Modelo',           ARRAY['modelo','model','sku','part number','referencia'],                     1.0, 'es'),
  (0, v_electronics, 'dimensions',    'Dimensiones',      ARRAY['dimensiones','dimensions','mm','cm','inches','size','tamaño'],         0.9, 'es'),
  (0, v_electronics, 'power',         'Potencia / batería', ARRAY['power','potencia','watts','w','battery','bateria','mah','voltaje'], 0.9, 'es'),
  (0, v_electronics, 'connectivity',  'Conectividad',     ARRAY['bluetooth','wifi','usb','hdmi','jack','aux','wireless','inalambrico'], 0.7, 'es'),
  (0, v_electronics, 'warranty',      'Garantía',         ARRAY['garantia','warranty','años','years','meses','months'],                  0.6, 'es');
end $$;
