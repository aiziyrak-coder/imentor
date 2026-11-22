"""Ota-onalar boti matnlari: o'zbek, rus, ingliz (2026-10-22).

Matnlar HTML (Telegram `parse_mode=HTML`); o'zgaruvchilar `tr()` ga berilishidan
oldin `html.escape` qilinadi. Uchala tilda kalitlar bir xil bo'lishi testda tekshiriladi.
"""

from __future__ import annotations

LANGS = ("uz", "ru", "en")
LANG_NAMES = {"uz": "🇺🇿 O‘zbekcha", "ru": "🇷🇺 Русский", "en": "🇬🇧 English"}

T: dict[str, dict[str, str]] = {
    "uz": {
        "choose_lang": "Tilni tanlang:",
        "welcome": (
            "Assalomu alaykum! Bu — <b>iMentor</b> ota-onalar boti\n"
            "(Farg‘ona jamoat salomatligi tibbiyot instituti).\n\n"
            "Bu yerda farzandingizning har bir darsdagi test natijasini kuzatib borasiz: "
            "qaysi kuni, nechanchi parada, qaysi fandan, qaysi mavzu bo‘yicha va necha ball olgani.\n\n"
            "• har bir yangi natija o‘zi keladi;\n"
            "• har kuni kechqurun kunlik hisobot;\n"
            "• istalgan kunning darslari va butun natijalar tarixi.\n\n"
            "Boshlash uchun farzandingizni qo‘shing 👇"
        ),
        "btn_today": "📅 Bugungi darslar",
        "btn_history": "📚 Natijalar tarixi",
        "btn_children": "👨‍👩‍👧 Farzandlarim",
        "btn_add": "➕ Farzand qo‘shish",
        "btn_settings": "⚙️ Sozlamalar",
        "btn_help": "❓ Yordam",
        "btn_back": "⬅️ Orqaga",
        "btn_cancel": "✖️ Bekor qilish",
        "btn_prev": "◀️",
        "btn_next": "▶️",
        "btn_prev_day": "◀️ Oldingi kun",
        "btn_next_day": "Keyingi kun ▶️",
        "btn_today_short": "📅 Bugun",
        "btn_that_day": "📅 Shu kun",
        "need_id": "Farzandingizning tug‘ilgan sanasi HEMIS’da yozilmagan. Uning 12 xonali talaba ID raqamini yozing.",
        "too_many_student": "Bu talaba uchun bugun juda ko‘p noto‘g‘ri urinish bo‘ldi. Ertaga qayta urinib ko‘ring.",
        "new_parent": "ℹ️ <b>{name}</b> ga yana bir Telegram hisob ulandi: {who}.\nAgar bu siz tanigan odam bo‘lmasa, dekanatga xabar bering.",
        "btn_older": "◀️ Avvalgilari",
        "btn_newer": "Keyingilari ▶️",
        "btn_subjects": "📈 Fanlar bo‘yicha",
        "btn_results": "📚 Natijalar",
        "btn_remove": "❌ Olib tashlash",
        "btn_yes_remove": "Ha, olib tashlash",
        "btn_no": "Yo‘q",
        "btn_daily_on": "🔔 Kunlik hisobotni yoqish",
        "btn_daily_off": "🔕 Kunlik hisobotni o‘chirish",
        "btn_language": "🌐 Tilni o‘zgartirish",
        "pick_faculty": "Farzandingiz qaysi fakultetda o‘qiydi?",
        "pick_course": "<b>{faculty}</b>\n\nNechanchi kursda?",
        "course": "{n}-kurs",
        "pick_group": "<b>{faculty}</b>, {course}-kurs\n\nGuruhini tanlang:",
        "pick_student": "Guruh <b>{group}</b>\n\nFarzandingizni tanlang:",
        "page": "{page}/{pages}-sahifa",
        "nothing_found": "Ro‘yxat bo‘sh. Boshqasini tanlang.",
        "ask_birth": (
            "<b>{name}</b> · {group}\n\n"
            "Tasdiqlash uchun farzandingizning <b>tug‘ilgan sanasini</b> yozing.\n"
            "Masalan: <code>05.03.2006</code>\n\n"
            "<i>Bu begona odam boshqa birovning farzandi natijalarini ko‘rmasligi uchun kerak.</i>"
        ),
        "bad_format": "Sanani kk.oo.yyyy ko‘rinishida yozing, masalan: <code>05.03.2006</code>",
        "bad_birth": "Sana mos kelmadi. Yana urinib ko‘ring (yana {left} ta urinish bor).",
        "too_many": (
            "Bugun noto‘g‘ri urinishlar ko‘p bo‘ldi. Ertaga qayta urinib ko‘ring.\n"
            "Farzandingizdan tug‘ilgan sanasini hujjatdagidek aniq so‘rang."
        ),
        "linked": (
            "✅ <b>{name}</b> ulandi.\n\n"
            "Endi uning har bir test natijasi shu yerga keladi, kechqurun esa kunlik hisobot.\n"
            "Darslarni ko‘rish: «📅 Bugungi darslar»."
        ),
        "already_linked": "<b>{name}</b> allaqachon ulangan.",
        "limit_children": "Bitta hisobga ko‘pi bilan {n} nafar farzand ulash mumkin.",
        "limit_parents": "Bu talabaga allaqachon {n} ta Telegram hisob ulangan. Ortiqchasini olib tashlab, keyin qo‘shing.",
        "cancelled": "Bekor qilindi.",
        "no_children": "Hali farzand ulanmagan. «➕ Farzand qo‘shish» tugmasini bosing.",
        "children_title": "👨‍👩‍👧 <b>Ulangan farzandlar</b>",
        "child_card": "<b>{name}</b>\n{faculty}, {course}-kurs, guruh {group}",
        "child_inactive": "⚠️ HEMIS’da faol talaba emas ({status})",
        "remove_confirm": "<b>{name}</b> ro‘yxatdan olib tashlansinmi? Unga oid xabarlar kelmay qoladi.",
        "removed": "<b>{name}</b> olib tashlandi.",
        "pick_child": "Qaysi farzand?",
        "day_title": "📅 <b>{date}</b>, {weekday}\n👤 <b>{name}</b> · {group}",
        "no_lessons": "Bu kuni HEMIS jadvalida dars yo‘q.",
        "lesson": "<b>{para}</b> · {start}–{end}\n{subject}{kind}",
        "test_result": "✅ Test: <b>{score}/{total}</b> ({pct}%) · baho <b>{grade}</b>",
        "topic": "📌 {topic}",
        "test_pending": "⏳ Test topshirilgan, natija o‘qituvchi yakunlagach chiqadi",
        "test_missed": "⚠️ Guruhda test o‘tkazildi ({n} nafar topshirdi), farzandingiz natijasi yo‘q",
        "no_test": "— test natijasi yo‘q",
        "outside_lessons": "<b>Dars vaqtidan tashqari testlar</b>",
        "day_total": "Kun bo‘yicha: {n} ta test, o‘rtacha <b>{pct}%</b>",
        "history_title": "📚 <b>{name}</b> · test natijalari",
        "history_stats": "So‘nggi 30 kun: {n} ta test, o‘rtacha <b>{pct}%</b> (baho {grade})",
        "history_empty": "Hali test natijasi yo‘q.",
        "history_item": "<b>{date}</b> · {para} · {subject}\n   📌 {topic}\n   <b>{score}/{total}</b> ({pct}%) · {grade}",
        "subjects_title": "📈 <b>{name}</b> · fanlar bo‘yicha (o‘quv yili)",
        "subject_item": "<b>{subject}</b>\n   {n} ta test, o‘rtacha <b>{pct}%</b> · oxirgisi {last}",
        "notice_title": "📝 <b>Yangi test natijasi</b>",
        "notice_many_title": "📝 <b>Yangi test natijalari ({n})</b>",
        "notice_student": "👤 <b>{name}</b> · {group}",
        "notice_when": "📅 {date}, {weekday} · <b>{para}</b>",
        "notice_subject": "📘 {subject}",
        "notice_topic": "📌 Mavzu: {topic}",
        "notice_score": "✅ Natija: <b>{score}/{total}</b> ({pct}%) · baho <b>{grade}</b> ({grade_name})",
        "notice_avg": "👥 Shu testda o‘rtacha: {avg}/{total}",
        "daily_title": "🌙 <b>Kunlik hisobot</b>",
        "para_outside": "dars vaqtidan tashqari, {time}",
        "settings": "⚙️ <b>Sozlamalar</b>\n\nKunlik hisobot (har kuni {at} da): <b>{state}</b>\nTil: {lang}",
        "on": "yoqilgan",
        "off": "o‘chirilgan",
        "help": (
            "❓ <b>Yordam</b>\n\n"
            "• «➕ Farzand qo‘shish» — fakultet, kurs, guruhni tanlab, farzandingizni ro‘yxatdan toping "
            "va tug‘ilgan sanasi bilan tasdiqlang. Bir nechta farzandni qo‘shish mumkin.\n"
            "• «📅 Bugungi darslar» — bugungi paralar va har biridagi test natijasi; ◀️ ▶️ bilan boshqa kunlar.\n"
            "• «📚 Natijalar tarixi» — barcha testlar va fanlar bo‘yicha o‘rtacha.\n"
            "• Har bir yangi natija o‘zi keladi. Natija o‘qituvchi testni yakunlagach "
            "(yoki darsdan keyin) yuboriladi.\n\n"
            "Dars jadvali HEMIS’dan, natijalar iMentor’dan olinadi."
        ),
        "unknown": "Quyidagi menyudan tanlang 👇",
        "stale": "Bu tugma eskirgan, qaytadan boshlang.",
        "grade_5": "a’lo", "grade_4": "yaxshi", "grade_3": "qoniqarli", "grade_2": "qoniqarsiz",
        "weekdays": "dushanba,seshanba,chorshanba,payshanba,juma,shanba,yakshanba",
        "lesson_kind": " ({kind})",
        "para": "{n}-para",
        "verify_hint": "Sana HEMIS’da boshqacha yozilgan bo‘lsa, farzandingizning 12 xonali talaba ID raqamini ham yozishingiz mumkin.",
    },
    "ru": {
        "choose_lang": "Выберите язык:",
        "welcome": (
            "Здравствуйте! Это бот <b>iMentor</b> для родителей\n"
            "(Ферганский медицинский институт общественного здоровья).\n\n"
            "Здесь вы видите результат каждого теста вашего ребёнка на занятиях: "
            "в какой день, на какой паре, по какому предмету и теме и сколько баллов он набрал.\n\n"
            "• каждый новый результат приходит сам;\n"
            "• каждый вечер — отчёт за день;\n"
            "• занятия за любой день и вся история результатов.\n\n"
            "Для начала добавьте ребёнка 👇"
        ),
        "btn_today": "📅 Занятия сегодня",
        "btn_history": "📚 История результатов",
        "btn_children": "👨‍👩‍👧 Мои дети",
        "btn_add": "➕ Добавить ребёнка",
        "btn_settings": "⚙️ Настройки",
        "btn_help": "❓ Помощь",
        "btn_back": "⬅️ Назад",
        "btn_cancel": "✖️ Отмена",
        "btn_prev": "◀️",
        "btn_next": "▶️",
        "btn_prev_day": "◀️ Предыдущий день",
        "btn_next_day": "Следующий день ▶️",
        "btn_today_short": "📅 Сегодня",
        "btn_that_day": "📅 Этот день",
        "need_id": "Дата рождения вашего ребёнка не указана в HEMIS. Введите его 12-значный ID студента.",
        "too_many_student": "Для этого студента сегодня было слишком много неверных попыток. Попробуйте завтра.",
        "new_parent": "ℹ️ К <b>{name}</b> подключён ещё один аккаунт Telegram: {who}.\nЕсли вы его не знаете, сообщите в деканат.",
        "btn_older": "◀️ Ранее",
        "btn_newer": "Позже ▶️",
        "btn_subjects": "📈 По предметам",
        "btn_results": "📚 Результаты",
        "btn_remove": "❌ Удалить",
        "btn_yes_remove": "Да, удалить",
        "btn_no": "Нет",
        "btn_daily_on": "🔔 Включить отчёт за день",
        "btn_daily_off": "🔕 Выключить отчёт за день",
        "btn_language": "🌐 Сменить язык",
        "pick_faculty": "На каком факультете учится ваш ребёнок?",
        "pick_course": "<b>{faculty}</b>\n\nНа каком курсе?",
        "course": "{n} курс",
        "pick_group": "<b>{faculty}</b>, {course} курс\n\nВыберите группу:",
        "pick_student": "Группа <b>{group}</b>\n\nВыберите вашего ребёнка:",
        "page": "стр. {page}/{pages}",
        "nothing_found": "Список пуст. Выберите другое.",
        "ask_birth": (
            "<b>{name}</b> · {group}\n\n"
            "Для подтверждения напишите <b>дату рождения</b> ребёнка.\n"
            "Например: <code>05.03.2006</code>\n\n"
            "<i>Это нужно, чтобы посторонний не мог видеть результаты чужого ребёнка.</i>"
        ),
        "bad_format": "Напишите дату в виде дд.мм.гггг, например: <code>05.03.2006</code>",
        "bad_birth": "Дата не совпала. Попробуйте ещё раз (осталось попыток: {left}).",
        "too_many": (
            "Сегодня было слишком много неверных попыток. Попробуйте завтра.\n"
            "Уточните у ребёнка дату рождения точно как в документе."
        ),
        "linked": (
            "✅ <b>{name}</b> подключён(а).\n\n"
            "Теперь каждый результат теста будет приходить сюда, а вечером — отчёт за день.\n"
            "Занятия: «📅 Занятия сегодня»."
        ),
        "already_linked": "<b>{name}</b> уже подключён(а).",
        "limit_children": "К одному аккаунту можно подключить не более {n} детей.",
        "limit_parents": "К этому студенту уже подключено {n} аккаунтов Telegram. Удалите лишний и повторите.",
        "cancelled": "Отменено.",
        "no_children": "Дети ещё не добавлены. Нажмите «➕ Добавить ребёнка».",
        "children_title": "👨‍👩‍👧 <b>Подключённые дети</b>",
        "child_card": "<b>{name}</b>\n{faculty}, {course} курс, группа {group}",
        "child_inactive": "⚠️ В HEMIS не числится активным студентом ({status})",
        "remove_confirm": "Удалить <b>{name}</b> из списка? Уведомления по нему приходить не будут.",
        "removed": "<b>{name}</b> удалён(а).",
        "pick_child": "Какой ребёнок?",
        "day_title": "📅 <b>{date}</b>, {weekday}\n👤 <b>{name}</b> · {group}",
        "no_lessons": "В этот день в расписании HEMIS занятий нет.",
        "lesson": "<b>{para}</b> · {start}–{end}\n{subject}{kind}",
        "test_result": "✅ Тест: <b>{score}/{total}</b> ({pct}%) · оценка <b>{grade}</b>",
        "topic": "📌 {topic}",
        "test_pending": "⏳ Тест сдан, результат появится после завершения преподавателем",
        "test_missed": "⚠️ В группе был тест (сдали {n}), результата вашего ребёнка нет",
        "no_test": "— результата теста нет",
        "outside_lessons": "<b>Тесты вне расписания</b>",
        "day_total": "За день: тестов {n}, в среднем <b>{pct}%</b>",
        "history_title": "📚 <b>{name}</b> · результаты тестов",
        "history_stats": "Последние 30 дней: тестов {n}, в среднем <b>{pct}%</b> (оценка {grade})",
        "history_empty": "Результатов тестов пока нет.",
        "history_item": "<b>{date}</b> · {para} · {subject}\n   📌 {topic}\n   <b>{score}/{total}</b> ({pct}%) · {grade}",
        "subjects_title": "📈 <b>{name}</b> · по предметам (учебный год)",
        "subject_item": "<b>{subject}</b>\n   тестов {n}, в среднем <b>{pct}%</b> · последний {last}",
        "notice_title": "📝 <b>Новый результат теста</b>",
        "notice_many_title": "📝 <b>Новые результаты тестов ({n})</b>",
        "notice_student": "👤 <b>{name}</b> · {group}",
        "notice_when": "📅 {date}, {weekday} · <b>{para}</b>",
        "notice_subject": "📘 {subject}",
        "notice_topic": "📌 Тема: {topic}",
        "notice_score": "✅ Результат: <b>{score}/{total}</b> ({pct}%) · оценка <b>{grade}</b> ({grade_name})",
        "notice_avg": "👥 Средний балл по тесту: {avg}/{total}",
        "daily_title": "🌙 <b>Отчёт за день</b>",
        "para_outside": "вне расписания, {time}",
        "settings": "⚙️ <b>Настройки</b>\n\nОтчёт за день (каждый день в {at}): <b>{state}</b>\nЯзык: {lang}",
        "on": "включён",
        "off": "выключен",
        "help": (
            "❓ <b>Помощь</b>\n\n"
            "• «➕ Добавить ребёнка» — выберите факультет, курс, группу, найдите ребёнка в списке "
            "и подтвердите датой рождения. Можно добавить несколько детей.\n"
            "• «📅 Занятия сегодня» — пары за день и результат теста на каждой; ◀️ ▶️ — другие дни.\n"
            "• «📚 История результатов» — все тесты и средний балл по предметам.\n"
            "• Каждый новый результат приходит сам — после того как преподаватель завершит тест "
            "(или после занятия).\n\n"
            "Расписание берётся из HEMIS, результаты — из iMentor."
        ),
        "unknown": "Выберите в меню ниже 👇",
        "stale": "Эта кнопка устарела, начните заново.",
        "grade_5": "отлично", "grade_4": "хорошо", "grade_3": "удовлетворительно", "grade_2": "неудовлетворительно",
        "weekdays": "понедельник,вторник,среда,четверг,пятница,суббота,воскресенье",
        "lesson_kind": " ({kind})",
        "para": "{n}-я пара",
        "verify_hint": "Если в HEMIS дата записана иначе, можно ввести 12-значный ID студента.",
    },
    "en": {
        "choose_lang": "Choose a language:",
        "welcome": (
            "Hello! This is the <b>iMentor</b> bot for parents\n"
            "(Fergana Medical Institute of Public Health).\n\n"
            "Here you follow your child's result in every class test: "
            "the day, the class period, the subject and topic, and the score.\n\n"
            "• every new result arrives automatically;\n"
            "• a daily report every evening;\n"
            "• classes for any day and the full results history.\n\n"
            "To start, add your child 👇"
        ),
        "btn_today": "📅 Today's classes",
        "btn_history": "📚 Results history",
        "btn_children": "👨‍👩‍👧 My children",
        "btn_add": "➕ Add a child",
        "btn_settings": "⚙️ Settings",
        "btn_help": "❓ Help",
        "btn_back": "⬅️ Back",
        "btn_cancel": "✖️ Cancel",
        "btn_prev": "◀️",
        "btn_next": "▶️",
        "btn_prev_day": "◀️ Previous day",
        "btn_next_day": "Next day ▶️",
        "btn_today_short": "📅 Today",
        "btn_that_day": "📅 That day",
        "need_id": "Your child’s birth date is not recorded in HEMIS. Type their 12-digit student ID instead.",
        "too_many_student": "Too many wrong attempts for this student today. Try again tomorrow.",
        "new_parent": "ℹ️ Another Telegram account was connected to <b>{name}</b>: {who}.\nIf you don’t know this person, tell the dean’s office.",
        "btn_older": "◀️ Older",
        "btn_newer": "Newer ▶️",
        "btn_subjects": "📈 By subject",
        "btn_results": "📚 Results",
        "btn_remove": "❌ Remove",
        "btn_yes_remove": "Yes, remove",
        "btn_no": "No",
        "btn_daily_on": "🔔 Turn daily report on",
        "btn_daily_off": "🔕 Turn daily report off",
        "btn_language": "🌐 Change language",
        "pick_faculty": "Which faculty does your child study at?",
        "pick_course": "<b>{faculty}</b>\n\nWhich year?",
        "course": "Year {n}",
        "pick_group": "<b>{faculty}</b>, year {course}\n\nChoose the group:",
        "pick_student": "Group <b>{group}</b>\n\nChoose your child:",
        "page": "page {page}/{pages}",
        "nothing_found": "The list is empty. Choose another one.",
        "ask_birth": (
            "<b>{name}</b> · {group}\n\n"
            "To confirm, type your child's <b>date of birth</b>.\n"
            "For example: <code>05.03.2006</code>\n\n"
            "<i>This keeps strangers from seeing someone else's child's results.</i>"
        ),
        "bad_format": "Type the date as dd.mm.yyyy, for example: <code>05.03.2006</code>",
        "bad_birth": "The date does not match. Try again ({left} attempts left).",
        "too_many": (
            "Too many wrong attempts today. Please try again tomorrow.\n"
            "Ask your child for the exact date of birth as in their documents."
        ),
        "linked": (
            "✅ <b>{name}</b> is connected.\n\n"
            "Every test result will now arrive here, plus a daily report in the evening.\n"
            "Classes: «📅 Today's classes»."
        ),
        "already_linked": "<b>{name}</b> is already connected.",
        "limit_children": "Up to {n} children can be connected to one account.",
        "limit_parents": "{n} Telegram accounts are already connected to this student. Remove one and try again.",
        "cancelled": "Cancelled.",
        "no_children": "No children connected yet. Press «➕ Add a child».",
        "children_title": "👨‍👩‍👧 <b>Connected children</b>",
        "child_card": "<b>{name}</b>\n{faculty}, year {course}, group {group}",
        "child_inactive": "⚠️ Not an active student in HEMIS ({status})",
        "remove_confirm": "Remove <b>{name}</b> from the list? You will stop receiving messages about them.",
        "removed": "<b>{name}</b> removed.",
        "pick_child": "Which child?",
        "day_title": "📅 <b>{date}</b>, {weekday}\n👤 <b>{name}</b> · {group}",
        "no_lessons": "No classes in the HEMIS timetable on this day.",
        "lesson": "<b>{para}</b> · {start}–{end}\n{subject}{kind}",
        "test_result": "✅ Test: <b>{score}/{total}</b> ({pct}%) · grade <b>{grade}</b>",
        "topic": "📌 {topic}",
        "test_pending": "⏳ Test submitted, the result appears once the teacher closes it",
        "test_missed": "⚠️ The group took a test ({n} submitted), no result from your child",
        "no_test": "— no test result",
        "outside_lessons": "<b>Tests outside the timetable</b>",
        "day_total": "For the day: {n} tests, average <b>{pct}%</b>",
        "history_title": "📚 <b>{name}</b> · test results",
        "history_stats": "Last 30 days: {n} tests, average <b>{pct}%</b> (grade {grade})",
        "history_empty": "No test results yet.",
        "history_item": "<b>{date}</b> · {para} · {subject}\n   📌 {topic}\n   <b>{score}/{total}</b> ({pct}%) · {grade}",
        "subjects_title": "📈 <b>{name}</b> · by subject (academic year)",
        "subject_item": "<b>{subject}</b>\n   {n} tests, average <b>{pct}%</b> · last on {last}",
        "notice_title": "📝 <b>New test result</b>",
        "notice_many_title": "📝 <b>New test results ({n})</b>",
        "notice_student": "👤 <b>{name}</b> · {group}",
        "notice_when": "📅 {date}, {weekday} · <b>{para}</b>",
        "notice_subject": "📘 {subject}",
        "notice_topic": "📌 Topic: {topic}",
        "notice_score": "✅ Score: <b>{score}/{total}</b> ({pct}%) · grade <b>{grade}</b> ({grade_name})",
        "notice_avg": "👥 Test average: {avg}/{total}",
        "daily_title": "🌙 <b>Daily report</b>",
        "para_outside": "outside the timetable, {time}",
        "settings": "⚙️ <b>Settings</b>\n\nDaily report (every day at {at}): <b>{state}</b>\nLanguage: {lang}",
        "on": "on",
        "off": "off",
        "help": (
            "❓ <b>Help</b>\n\n"
            "• «➕ Add a child» — choose the faculty, year and group, find your child in the list "
            "and confirm with the date of birth. You can add several children.\n"
            "• «📅 Today's classes» — the day's class periods and the test result in each; ◀️ ▶️ for other days.\n"
            "• «📚 Results history» — all tests and the average per subject.\n"
            "• Every new result arrives by itself once the teacher closes the test (or after the class).\n\n"
            "The timetable comes from HEMIS, the results from iMentor."
        ),
        "unknown": "Please choose from the menu below 👇",
        "stale": "This button is out of date, please start again.",
        "grade_5": "excellent", "grade_4": "good", "grade_3": "satisfactory", "grade_2": "unsatisfactory",
        "weekdays": "Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday",
        "lesson_kind": " ({kind})",
        "para": "period {n}",
        "verify_hint": "If HEMIS has a different date, you can type the 12-digit student ID instead.",
    },
}


def lang_of(code: str | None) -> str:
    code = (code or "").lower()[:2]
    return code if code in LANGS else "uz"


def tr(lang: str, key: str, /, **kw) -> str:
    text = T[lang_of(lang)].get(key) or T["uz"][key]
    return text.format(**kw) if kw else text


def weekday(lang: str, day) -> str:
    return tr(lang, "weekdays").split(",")[day.weekday()]


def menu_buttons() -> dict[str, str]:
    """Pastki menyu matni → buyruq (uchala tilda ham tanilsin: til almashsa eski tugma ham ishlaydi)."""
    out: dict[str, str] = {}
    for lang in LANGS:
        for key in ("btn_today", "btn_history", "btn_children", "btn_add", "btn_settings", "btn_help"):
            out[T[lang][key]] = key
    return out
