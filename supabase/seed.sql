-- Kiksu seed data.
--
-- Idempotent: safe to run repeatedly. Every insert guards on a natural key.
-- Content is drawn from design/kiksu-mobile-screens.html so the designed
-- screens render with real data rather than placeholders. Azerbaijani text is
-- written as Azerbaijani, not translated from English.
--
-- Scope of this file: reference data and the academic spine — universities,
-- calendar, campuses, rooms, faculties, instructors, courses, sections and
-- meetings, absence policy, boards, and a small set of users. Forum content,
-- reviews, listings and vacancies are seeded separately.

begin;

-- ---------------------------------------------------------------------
-- Universities. Domains and absence limits are per-institution config;
-- nothing about them is hardcoded anywhere in the application.
-- ---------------------------------------------------------------------
insert into ref.university (code, name_az, name_en, city_az, city_en, timezone, default_absence_limit)
values
  ('BDU',  'Bakı Dövlət Universiteti',              'Baku State University',            'Bakı',     'Baku',     'Asia/Baku', 12),
  ('ADA',  'ADA Universiteti',                      'ADA University',                   'Bakı',     'Baku',     'Asia/Baku', 10),
  ('UNEC', 'Azərbaycan Dövlət İqtisad Universiteti','Azerbaijan State Univ. of Economics','Bakı',   'Baku',     'Asia/Baku', 12),
  ('BMU',  'Bakı Mühəndislik Universiteti',         'Baku Engineering University',      'Xırdalan', 'Khirdalan','Asia/Baku', 12)
on conflict (code) do nothing;

-- Email domains. The design's onboarding screen shows ad.soyad@std.bsu.edu.az.
-- sample_pattern is rendered on the onboarding screen, which shows
-- "ad.soyad@std.bsu.edu.az" under the university-email option.
insert into ref.university_email_domain (university_id, domain, audience, sample_pattern, is_primary)
select u.id, d.domain, d.audience, d.sample, d.primary_
  from ref.university u
  join (values
    ('BDU', 'std.bsu.edu.az',  'student', 'ad.soyad@std.bsu.edu.az',  true),
    ('BDU', 'bsu.edu.az',      'staff',   'ad.soyad@bsu.edu.az',      false),
    ('ADA', 'ada.edu.az',      'student', 'ad.soyad@ada.edu.az',      true),
    ('UNEC','std.unec.edu.az', 'student', 'ad.soyad@std.unec.edu.az', true),
    ('UNEC','unec.edu.az',     'staff',   'ad.soyad@unec.edu.az',     false),
    ('BMU', 'std.beu.edu.az',  'student', 'ad.soyad@std.beu.edu.az',  true),
    ('BMU', 'beu.edu.az',      'staff',   'ad.soyad@beu.edu.az',      false)
  ) as d(code, domain, audience, sample, primary_) on d.code = u.code
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Verification routes. The onboarding screen renders these with their SLAs:
-- university email "2 dəqiqə" and recommended, student card "24 saata qədər",
-- invite code from a coursemate. The SLAs are promises the queue must actually
-- keep, so they are configuration per university rather than copy in the app.
-- ---------------------------------------------------------------------
insert into ref.university_verification_route
  (university_id, method, is_enabled, is_recommended, sla_minutes, display_order, note_az)
select u.id, r.method::public.verification_method, true, r.recommended, r.sla, r.ord, r.note
  from ref.university u
  join (values
    ('university_email', true,  2,    1, 'Universitet e-poçtunuza 6 rəqəmli kod göndərilir.'),
    ('student_card',     false, 1440, 2, 'Tələbə kartının şəkli əl ilə yoxlanılır.'),
    ('invite_code',      false, 2,    3, 'Kursdaşınızdan aldığınız 6 rəqəmli kod.')
  ) as r(method, recommended, sla, ord, note) on true
on conflict (university_id, method) do nothing;

-- ---------------------------------------------------------------------
-- Academic calendar. The design's timetable header reads
-- "2025/26 · PAYIZ SEMESTRİ".
-- ---------------------------------------------------------------------
insert into ref.academic_year (university_id, label, starts_on, ends_on)
select id, '2025/26', date '2025-09-15', date '2026-06-30' from ref.university
on conflict do nothing;

insert into ref.term (university_id, academic_year_id, season, label, starts_on, ends_on,
                      add_drop_ends_on, exams_start_on, is_current)
select ay.university_id, ay.id, 'payiz', '2025/26 Payız',
       date '2025-09-15', date '2026-01-25', date '2025-10-03', date '2026-01-05', true
  from ref.academic_year ay where ay.label = '2025/26'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Campuses and rooms. Room codes come straight off the design:
-- "II KORPUS 312", "BAŞ KORPUS 205", the "L-3" lab.
-- ---------------------------------------------------------------------
insert into ref.campus (university_id, name_az)
select u.id, c.name
  from ref.university u
  join (values ('BDU','Baş korpus'), ('BDU','II korpus'),
               ('ADA','Əsas kampus'), ('UNEC','Baş bina'), ('BMU','Kampus')) as c(code, name)
    on c.code = u.code
on conflict do nothing;

insert into ref.room (campus_id, code, capacity, kind)
select ca.id, r.code, r.cap, r.kind
  from ref.campus ca
  join ref.university u on u.id = ca.university_id
  join (values
    ('Baş korpus','205',60,'auditorium'), ('Baş korpus','108',45,'classroom'),
    ('Baş korpus','117',80,'auditorium'), ('Baş korpus','220',50,'classroom'),
    ('Baş korpus','401',40,'classroom'),  ('Baş korpus','L-3',24,'lab'),
    ('II korpus','312',55,'classroom'),   ('II korpus','305',30,'lab')
  ) as r(campus, code, cap, kind) on r.campus = ca.name_az
 where u.code = 'BDU'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Faculties, departments, instructors.
-- ---------------------------------------------------------------------
insert into ref.faculty (university_id, name_az, code)
select u.id, f.name, f.code
  from ref.university u
  join (values
    ('BDU','Tətbiqi riyaziyyat və kibernetika','TRK'),
    ('BDU','Filologiya','FIL'),
    ('BDU','Tarix','TAR'),
    ('ADA','İnformasiya texnologiyaları','IT'),
    ('UNEC','İqtisadiyyat','IQT'),
    ('BMU','Mühəndislik','MUH')
  ) as f(code_u, name, code) on f.code_u = u.code
on conflict do nothing;

insert into ref.department (university_id, faculty_id, name_az, code)
select f.university_id, f.id, 'İnformatika', 'INF'
  from ref.faculty f
  join ref.university u on u.id = f.university_id
 where u.code = 'BDU' and f.code = 'TRK'
on conflict do nothing;

-- The design's professor profile: "dos. Nigar Əliyeva · İNFORMATİKA
-- KAFEDRASI · BDU", rated 4.2 across 3 courses.
insert into ref.instructor (university_id, department_id, full_name, slug, title_prefix, initials)
select u.id, d.id, i.name, i.slug, i.prefix, i.initials
  from ref.university u
  left join ref.department d on d.university_id = u.id and d.code = 'INF'
  join (values
    ('Nigar Əliyeva',   'nigar-eliyeva',   'dos.',  'NƏ'),
    ('Elçin Məmmədov',  'elcin-mammadov',  'prof.', 'EM'),
    ('Aygün Quliyeva',  'aygun-quliyeva',  'dos.',  'AQ'),
    ('Rəşad Hüseynov',  'resad-huseynov',  'b/m.',  'RH'),
    ('Leyla Səfərova',  'leyla-seferova',  'dos.',  'LS')
  ) as i(name, slug, prefix, initials) on true
 where u.code = 'BDU'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Courses. CS 214 is the design's worked example: 6 credits, taught by
-- dos. Nigar Əliyeva, 61 reviews, absence 4/12.
-- ---------------------------------------------------------------------
insert into ref.course (university_id, department_id, code, title_az, title_en, credits, level)
select u.id, d.id, c.code, c.az, c.en, c.credits, 1
  from ref.university u
  left join ref.department d on d.university_id = u.id and d.code = 'INF'
  join (values
    ('CS 214',   'Verilənlər bazası sistemləri', 'Database Systems',      6),
    ('MATH 201', 'Diskret riyaziyyat',           'Discrete Mathematics',  5),
    ('CS 220',   'Alqoritmlər',                  'Algorithms',            6),
    ('CS 220L',  'Alqoritmlər laboratoriyası',   'Algorithms Lab',        2),
    ('ENG 102',  'İngilis dili B2',              'English B2',            4),
    ('PHIL 101', 'Fəlsəfə',                      'Philosophy',            3),
    ('HIST 101', 'Azərbaycan tarixi',            'History of Azerbaijan', 3),
    ('ECON 110', 'Mikroiqtisadiyyat',            'Microeconomics',        5)
  ) as c(code, az, en, credits) on true
 where u.code = 'BDU'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Absence policy. The design shows "4 / 12" with expulsion at the limit.
-- Per-university configuration, never a constant in code.
-- ---------------------------------------------------------------------
insert into ref.absence_policy (university_id, max_absences, expulsion_at, warn_at_ratio, note_az)
select id, 12, 12, 0.33,
       'Ümumi qayda: 12 qaibdən sonra kursdan kənarlaşdırılma. Gecikmə yarım qaib sayılır.'
  from ref.university where code = 'BDU'
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Sections and the weekly grid. Times and rooms reproduce the design's
-- timetable screen. weekday is ISO-8601: 1 = Monday (B.E).
-- ---------------------------------------------------------------------
insert into ref.course_section (course_id, term_id, section_code, primary_instructor_id, capacity)
select c.id, t.id, '01', i.id, 55
  from ref.course c
  join ref.university u on u.id = c.university_id and u.code = 'BDU'
  join ref.term t on t.university_id = u.id and t.is_current
  -- the course -> instructor mapping must be joined BEFORE ref.instructor,
  -- since the instructor join predicate references it
  join (values
    ('CS 214','nigar-eliyeva'), ('MATH 201','elcin-mammadov'), ('CS 220','resad-huseynov'),
    ('CS 220L','resad-huseynov'), ('ENG 102','leyla-seferova'), ('PHIL 101','aygun-quliyeva'),
    ('HIST 101','aygun-quliyeva'), ('ECON 110','elcin-mammadov')
  ) as m(code, slug) on m.code = c.code
  left join ref.instructor i on i.university_id = u.id and i.slug = m.slug
on conflict do nothing;

insert into ref.section_meeting (section_id, room_id, weekday, starts_at, ends_at, kind)
select s.id, r.id, g.weekday, g.starts_at::time, g.ends_at::time, g.kind::public.meeting_kind
  from ref.course_section s
  join ref.course c on c.id = s.course_id
  join ref.university u on u.id = c.university_id and u.code = 'BDU'
  join (values
    -- code,      weekday, start,   end,     room,  kind
    ('CS 214',    2, '14:05', '15:25', '312', 'lecture'),   -- Ç.A, the design's "45 DƏQ SONRA" card
    ('CS 214',    4, '09:00', '10:20', '312', 'lecture'),
    ('MATH 201',  2, '15:40', '17:00', '205', 'lecture'),
    ('MATH 201',  5, '10:35', '11:55', '205', 'seminar'),
    ('CS 220',    3, '10:35', '11:55', '220', 'lecture'),
    ('CS 220L',   4, '14:05', '15:25', 'L-3', 'lab'),
    ('ENG 102',   1, '12:10', '13:30', '108', 'seminar'),
    ('ENG 102',   5, '12:10', '13:30', '108', 'seminar'),
    ('PHIL 101',  1, '09:00', '10:20', '401', 'lecture'),
    ('HIST 101',  3, '12:10', '13:30', '117', 'lecture')
  ) as g(code, weekday, starts_at, ends_at, room, kind) on g.code = c.code
  join ref.campus ca on ca.university_id = u.id
  join ref.room r on r.campus_id = ca.id and r.code = g.room
on conflict do nothing;

-- ---------------------------------------------------------------------
-- Boards. National boards carry the long tail that a single Azerbaijani
-- campus is too small to sustain; campus boards carry daily traffic.
-- follower_count is a counter cache with no trigger on insert, so seeding
-- it directly is correct here rather than double-counting.
-- ---------------------------------------------------------------------
insert into public.board (scope, university_id, slug, name_az, description_az, follower_count, is_default_follow)
values
  ('national', null, 'milli-serbest',   'Sərbəst söhbət (milli)', 'Bütün universitetlər üçün ümumi söhbət', 18432, true),
  ('national', null, 'tecrube-karyera', 'Təcrübə və karyera',     'Vakansiya, təcrübə proqramları, CV məsləhətləri', 12905, false),
  ('national', null, 'erasmus-mubadile','Erasmus və mübadilə',    'Mübadilə proqramları və təqaüdlər', 6120, false)
on conflict (university_id, slug) do nothing;

insert into public.board (scope, university_id, slug, name_az, description_az, follower_count, is_default_follow)
select 'university', u.id, b.slug, b.name, b.descr, b.followers, b.def
  from ref.university u
  join (values
    ('bdu-ders-ve-muellim', 'Dərs və müəllim',    'Fənlər, müəllimlər, imtahanlar', 9214, true),
    ('bdu-serbest-sohbet',  'Sərbəst söhbət',     'Kampus həyatı',                   7803, true),
    ('bdu-yataqxana',       'Yataqxana və kirayə','Kirayə, ev yoldaşı, yataqxana',    3140, false),
    ('bdu-birinci-kurs',    'Birinci kurs',       'Yeni tələbələr üçün',             2456, false)
  ) as b(slug, name, descr, followers, def) on true
 where u.code = 'BDU'
on conflict (university_id, slug) do nothing;

commit;
