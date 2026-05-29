-- Expand the vertical taxonomy from 7 → 31 so the auto-classifier
-- has enough resolution to land on the right industry for most
-- ecommerce storefronts. Each new vertical ships with detection
-- keywords (the same column the keyword-scoring layer of the
-- classifier reads). Synonym pairs + expected attributes per
-- vertical are a follow-up — adding the verticals themselves first
-- so prospects can be classified and the rubric scopes correctly.

insert into public.vertical (vertical_code, vertical_name, description, detection_keywords) values
('hardware_tools',     'Hardware & tools',
 'Power tools, hand tools, fasteners, building supplies, lumber.',
 '{drill,saw,hammer,screwdriver,wrench,tool,hardware,fastener,bolt,nut,screw,lumber,plumbing,electrical,taladro,sierra,martillo,destornillador,llave,herramienta,ferreteria,tornillo,tuerca,clavo,plomeria,dewalt,makita,bosch,milwaukee}'),

('jewelry',            'Jewelry & watches',
 'Fine and fashion jewelry, watches, engagement rings, gemstones.',
 '{ring,necklace,earring,bracelet,pendant,watch,gold,silver,diamond,sapphire,karat,carat,anillo,collar,pendiente,pulsera,joya,reloj,oro,plata,diamante,quilate,gema}'),

('sports_outdoor',     'Sports & outdoor',
 'Athletic gear, outdoor equipment, camping, hiking, cycling.',
 '{backpack,tent,hiking,camping,bicycle,bike,running,sports,soccer,basketball,fishing,kayak,mochila,tienda,senderismo,acampar,bicicleta,deporte,futbol,baloncesto,pesca}'),

('toys_games',         'Toys & games',
 'Children''s toys, action figures, dolls, board games, puzzles.',
 '{toy,doll,lego,puzzle,board game,action figure,plush,playset,juguete,muñeca,rompecabezas,juego,figura,peluche}'),

('books_media',        'Books & media',
 'Books, ebooks, audiobooks, magazines, vinyl, DVDs.',
 '{book,novel,paperback,hardcover,ebook,audiobook,vinyl,dvd,blu-ray,libro,novela,tapa blanda,tapa dura,audiolibro,vinilo,isbn,autor}'),

('automotive',         'Automotive parts & accessories',
 'Car parts, tires, accessories, oils, tools for vehicles.',
 '{car,vehicle,tire,brake,oil,engine,automotive,auto,oem,aftermarket,coche,vehiculo,neumatico,llanta,freno,aceite,motor,repuesto,refaccion}'),

('baby_kids',          'Baby & kids',
 'Strollers, cribs, diapers, baby clothing, kids accessories.',
 '{baby,infant,toddler,stroller,crib,diaper,bib,onesie,bebe,infantil,niño,cochecito,carriola,cuna,pañal,babero}'),

('health_supplements', 'Health & supplements',
 'Vitamins, protein, probiotics, sports nutrition, wellness.',
 '{vitamin,supplement,protein,omega,probiotic,multivitamin,collagen,creatine,whey,vitamina,suplemento,proteina,probiotico,multivitaminico,colageno}'),

('office_supplies',    'Office supplies',
 'Paper, pens, organization, printers, business supplies.',
 '{paper,pen,pencil,stapler,printer,desk,chair,organizer,binder,papel,lapiz,boligrafo,grapadora,impresora,escritorio,silla,carpeta,archivador}'),

('food_beverage',      'Specialty food & beverage',
 'Gourmet food, artisan products, snacks, chocolate, candy.',
 '{gourmet,artisan,organic,snack,chocolate,candy,nuts,gluten free,artesanal,organico,frutos secos,sin gluten,dulce,caramelo}'),

('arts_crafts',        'Arts & crafts',
 'Paints, canvases, yarn, scrapbooking, hobby supplies.',
 '{paint,canvas,brush,yarn,craft,scrapbook,beads,knitting,crochet,pintura,lienzo,pincel,hilo,artesania,manualidades,cuentas,tejido,croché}'),

('musical_instruments','Musical instruments',
 'Guitars, pianos, drums, audio gear, sheet music.',
 '{guitar,piano,drum,microphone,amplifier,keyboard,bass,violin,guitarra,bateria,microfono,amplificador,teclado,bajo,violin,partitura}'),

('luggage_bags',       'Luggage & bags',
 'Suitcases, backpacks, handbags, briefcases, travel gear.',
 '{luggage,suitcase,backpack,duffel,briefcase,handbag,tote,carry-on,equipaje,maleta,mochila,bolso,maletin,bandolera}'),

('furniture',          'Furniture',
 'Sofas, beds, tables, chairs, dressers, home furniture.',
 '{sofa,couch,armchair,table,desk,bed,dresser,bookshelf,sillon,butaca,mesa,escritorio,cama,comoda,estanteria}'),

('lighting',           'Lighting',
 'Lamps, chandeliers, bulbs, smart lighting, fixtures.',
 '{lamp,light,fixture,chandelier,bulb,sconce,pendant light,lampara,luz,candelabro,foco,bombilla,aplique,colgante}'),

('wine_spirits',       'Wine & spirits',
 'Wine, whiskey, vodka, beer, cellar accessories.',
 '{wine,whiskey,vodka,beer,spirit,cellar,vintage,merlot,cabernet,bourbon,vino,cerveza,licor,bodega,añejo,reserva}'),

('tea_coffee',         'Tea & coffee',
 'Coffee beans, tea leaves, brewing equipment, accessories.',
 '{coffee,espresso,latte,cappuccino,tea,brew,arabica,robusta,green tea,cafe,capuccino,té,grano,molido}'),

('eyewear',            'Eyewear',
 'Prescription glasses, sunglasses, frames, optical accessories.',
 '{glasses,sunglasses,frames,lens,eyewear,optical,prescription,polarized,lentes,gafas,anteojos,marcos,graduado,polarizado,opticos}'),

('mattress_bedding',   'Mattresses & bedding',
 'Mattresses, pillows, sheets, comforters, sleep accessories.',
 '{mattress,bed,pillow,sheets,comforter,duvet,memory foam,colchon,almohada,sabanas,edredon,funda,fibra}'),

('flowers_plants',     'Flowers & plants',
 'Live plants, cut flowers, gardening, indoor plants.',
 '{flower,plant,garden,succulent,bouquet,seed,planter,pot,flor,planta,jardin,suculenta,ramo,semilla,maceta}'),

('luxury_goods',       'Luxury goods',
 'High-end designer goods — luxury fashion, leather, accessories.',
 '{luxury,designer,premium,exclusive,couture,limited edition,lujo,exclusivo,coleccion,hermes,gucci,louis vuitton,chanel,prada,balenciaga}'),

('gaming',             'Gaming',
 'Video games, consoles, controllers, gaming peripherals.',
 '{gaming,console,controller,headset,mouse pad,steam,playstation,xbox,nintendo,switch,gpu,esports,videojuego,consola,mando}'),

('mobile_accessories', 'Mobile accessories',
 'Phone cases, chargers, cables, screen protectors.',
 '{case,charger,cable,screen protector,phone,iphone,samsung,airpods,powerbank,funda,cargador,protector,telefono,celular}'),

('apparel_athletic',   'Athletic apparel',
 'Activewear, performance clothing, athletic shoes.',
 '{leggings,running shoes,sneakers,sportswear,activewear,gym,workout,performance,zapatillas,deportiva,gimnasio,entrenamiento,running}')
on conflict (vertical_code) do nothing;
