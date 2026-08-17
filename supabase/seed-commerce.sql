-- Marketplace and vacancies. Content from design/kiksu-mobile-screens.html
-- screens 08 and 09, so those screens render with the data they were drawn for.
--
-- Depends on seed.sql (universities, term) and seed-content.sql (app_user rows
-- to own the listings).

begin;

-- ---------------------------------------------------------------------
-- Vocabularies.
-- ---------------------------------------------------------------------
insert into ref.marketplace_category (key, name_az, name_en)
values
  ('textbooks',   'Dərslik və qeydlər',  'Textbooks & notes'),
  ('electronics', 'Elektronika',         'Electronics'),
  ('furniture',   'Mebel və ev əşyaları','Furniture & household'),
  ('housing',     'Kirayə və yataqxana', 'Housing & rooms'),
  ('clothing',    'Geyim',               'Clothing'),
  ('other',       'Digər',               'Other')
on conflict (key) do nothing;

insert into ref.sector (key, name_az, name_en)
values
  ('it',        'İnformasiya texnologiyaları', 'Information technology'),
  ('banking',   'Bank və maliyyə',             'Banking & finance'),
  ('energy',    'Enerji və neft-qaz',          'Energy & oil and gas'),
  ('telecom',   'Telekommunikasiya',           'Telecommunications'),
  ('marketing', 'Marketinq',                   'Marketing')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Listings. Prices are integer minor units (qəpik): 25 ₼ = 2500.
-- The textbook is the design's worked example, down to the meetup note.
-- ---------------------------------------------------------------------
insert into public.listing
  (seller_id, university_id, category_id, related_course_id, title, description,
   price_minor, currency, is_negotiable, condition, meetup_notes, status, published_at)
select au.id, au.university_id, cat.id, crs.id, l.title, l.descr,
       l.price, 'AZN', l.negotiable, l.cond::public.listing_condition, array[l.meetup],
       'active', now() - (l.age_days || ' days')::interval
  from (values
    ('quru-püstə-19', 'textbooks', 'MATH 201',
     'Piskunov “Riyazi analiz” I–II cild, rus dilində', 2500, true, 'good',
     'Birinci kursda istifadə etmişəm, cildləri bütövdür. Bəzi səhifələrdə karandaşla qeydlər var.',
     'Baş korpusun qarşısında və ya “Elmlər Akademiyası” metrosunda təhvil verə bilərəm.', 2),
    ('sakit-pərvanə-37', 'textbooks', 'CS 214',
     'Verilənlər bazası dərsliyi + öz konspektim', 1800, true, 'like_new',
     'Keçən semestrdən qalıb. Konspekt əl yazısıdır, imtahana hazırlaşmaq üçün kifayətdir.',
     'II korpusda, dərslər arası.', 5),
    ('uzaq-ceyran-52', 'electronics', null,
     'Casio fx-991EX kalkulyator', 4500, false, 'good',
     'İki ildir istifadə edirəm, işlək vəziyyətdədir. Qutusu yoxdur.',
     'Baş korpus, günorta.', 1),
    ('isti-nar-08', 'furniture', null,
     'Yazı masası və oturacaq', 8000, true, 'fair',
     'Yataqxanadan çıxdığım üçün satıram. Özünüz aparmalısınız.',
     'Yasamal, ünvanı yazışmada.', 7),
    ('mavi-turac-71', 'housing', null,
     'Yasamalda 2 otaqlı, ev yoldaşı axtarılır', 35000, true, 'good',
     'Bir otaq boşdur. Kommunal ayrıca. Yalnız tələbə.',
     'Baxış üçün yazın.', 3),
    ('yaşıl-ənbər-63', 'textbooks', 'ENG 102',
     'İngilis dili B2 kitabı, işlənməmiş', 2000, false, 'new',
     'Səhvən iki dənə almışam. Tam yenidir.',
     'Baş korpus və ya Nizami metrosu.', 4)
  ) as l(handle, cat_key, course_code, title, price, negotiable, cond, descr, meetup, age_days)
  join public.app_user au on au.handle = l.handle
  join ref.marketplace_category cat on cat.key = l.cat_key
  left join ref.course crs on crs.code = l.course_code and crs.university_id = au.university_id
on conflict do nothing;

-- Seller reputation shown on the design's listing screen: 4.8 from 12 deals,
-- 100% response, ~2 hours, 0 complaints. These columns are recomputed on a
-- schedule from real deals in production; seeded directly here because there
-- are no deals to recompute from.
update public.app_user
   set trade_rating_sum = 58, trade_rating_count = 12, deal_count = 12,
       response_rate_pct = 100, response_time_median_sec = 7200, complaint_count = 0
 where handle = 'quru-püstə-19';

-- ---------------------------------------------------------------------
-- Employers and vacancies, straight from the design's Karyera screen.
-- ---------------------------------------------------------------------
insert into public.employer (slug, name, sector_id, logo_initials, brand_color, city, is_verified, is_active)
select e.slug, e.name, s.id, e.initials, e.colour, 'Bakı', true, true
  from (values
    ('azercell',     'Azercell',     'telecom',   'AZC', '#0F7A85'),
    ('kapital-bank', 'Kapital Bank', 'banking',   'KB',  '#B23A2F'),
    ('socar',        'SOCAR',        'energy',    'SC',  '#0F6F68'),
    ('pasha-bank',   'PASHA Bank',   'banking',   'PB',  '#141C24')
  ) as e(slug, name, sector_key, initials, colour)
  join ref.sector s on s.key = e.sector_key
on conflict (slug) do nothing;

insert into public.vacancy
  (employer_id, title, description, lang, kind, work_mode, city, sector_id,
   is_paid, stipend_minor, currency, duration_months, hours_per_week,
   min_study_year, max_study_year, required_skills, conversion_possible,
   transport_provided, schedule_friendly, apply_via, external_url,
   apply_deadline, status, posted_at)
select emp.id, v.title, v.descr, 'az', v.kind::public.vacancy_kind,
       v.mode::public.work_mode, v.city, emp.sector_id,
       v.paid, v.stipend, 'AZN', v.months, v.hours,
       v.min_year, v.max_year, v.skills, v.conversion, v.transport, v.friendly,
       -- apply_via='external' requires external_url (vacancy_apply_ck): a
       -- listing that says "apply on our site" with no site is not applyable,
       -- and the constraint is right to refuse it.
       'external', 'https://kariyer.example.az/' || emp.slug,
       now() + (v.days_left || ' days')::interval, 'active', now() - interval '2 days'
  from (values
    ('azercell', 'Frontend təcrübəçi (React)',
     'React və TypeScript ilə daxili məhsullar üzərində işləyəcəksiniz. Mentor dəstəyi var.',
     'internship', 'hybrid', 'Bakı', true, 70000, 6, null, 3, 4,
     array['React','TypeScript','Git'], false, false, false, 3),
    ('kapital-bank', 'Data analitik təcrübə proqramı',
     'SQL və Python ilə hesabat və analitika komandasında. Uğurlu iştirakçılara iş təklifi.',
     'internship', 'onsite', 'Bakı', true, 60000, 3, null, 3, 4,
     array['SQL','Python','Excel'], true, false, false, 11),
    ('socar', 'Yay təcrübə proqramı — mühəndislik',
     'Sumqayıt istehsalat sahəsində yay təcrübəsi. Nəqliyyat təmin olunur.',
     'internship', 'onsite', 'Sumqayıt', true, 50000, 2, null, 2, 4,
     array['Mühəndislik'], false, true, false, 24),
    ('pasha-bank', 'Marketinq üzrə yarımştat assistent',
     'Həftədə 20 saat, dərs cədvəlinizə uyğunlaşdırıla bilər.',
     'part_time', 'hybrid', 'Bakı', true, 45000, null, 20, 2, 4,
     array['Marketinq','Sosial media'], false, false, true, 30)
  ) as v(emp_slug, title, descr, kind, mode, city, paid, stipend, months, hours,
         min_year, max_year, skills, conversion, transport, friendly, days_left)
  join public.employer emp on emp.slug = v.emp_slug
on conflict do nothing;

commit;
