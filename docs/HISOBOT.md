# FaceSys Enterprise — Umumiy tekshiruv hisoboti

**Sana:** 2026-10-29
**Muhit:** Windows + Python 3.12 + Node 24.20 + PostgreSQL 17 (lokal), repo `face-id-control` (`fd5f00f` + joriy tuzatishlar)
**Maqsad:** tizimning to'liq ishlashini tekshirish, sig'imini baholash va test uchun ko'rsatishga tayyorligini aniqlash

---

## 1. Xulosa

Tizim **funksional jihatdan tayyor**: barcha asosiy modullar (xodimlar, bo'limlar, davomat, qurilmalar, smenalar, ta'tillar, hisobotlar, foydalanuvchilar/rollar, audit, sozlamalar, zaxira nusxalari) ishlaydi, rollar bo'yicha cheklovlar server tomonida bajariladi, avtomatik testlar va build yashil.

**Test uchun ko'rsatish mumkin**, lekin quyidagi 3 narsa bu muhitda ko'rsatilmaydi va buni hisobotda ochiq aytish kerak:

1. **Hikvision terminali bilan real almashinuv** — qurilma yo'q (kod yozilgan, ISAPI diagnostika bor, lekin fizik qurilmada sinalmagan).
2. **HTTPS/TLS** — sertifikat/domain yo'q, hozir faqat HTTP.
3. **Zaxira nusxasini tiklash mashqi** — alohida Linux hostda bajarilishi kerak.

---

## 2. Tizim nima qiladi

Klinika uchun lokal tarmoqdagi HR + Face ID davomat tizimi: xodimlar va bo'limlar hisobi, Hikvision yuz orqali davomat qaydlari, smena grafiklari (Excel import), ta'tillar, hisobotlar va audit.

**Arxitektura:** FastAPI + SQLAlchemy 2 + Alembic + PostgreSQL (backend), React 19 + TypeScript + Vite + Tailwind 4 (frontend), Nginx + systemd (deployment), Hikvision ISAPI integratsiyasi.

**Sahifalar:** Bosh sahifa, Xodimlar, Bo'limlar, Lavozimlar, Davomat, Face ID monitoring, Smenalar, Ta'tillar, Bayramlar, Hisobotlar, Face ID qurilmalari, Foydalanuvchilar/Rollar/Ruxsatlar, Audit jurnali, Sozlamalar, Zaxira nusxalari.

---

## 3. Tekshiruv natijalari

### 3.1 Avtomatik tekshiruvlar

| Tekshiruv | Buyruq | Natija |
|---|---|---|
| Backend testlari | `pytest -q` | ✅ **88 passed, 1 skipped** (migration testi opt-in) |
| Kod sifati | `ruff check backend/app backend/tests database` | ✅ toza |
| Frontend tiplari | `tsc -b` | ✅ xatosiz |
| Frontend lint | `eslint .` | ✅ xatosiz |
| Frontend build | `npm run build` | ✅ muvaffaqiyatli |
| Migratsiyalar | `alembic upgrade head` + `alembic check` | ✅ `0003` qo'llangan, drift yo'q |
| OpenAPI | 59 endpoint | ✅ generatsiya ishlaydi |

### 3.2 API smoke testi

Admin sifatida **30 ta GET endpoint** (barcha ro'yxat/dashboard/monitoring/hisobot/sozlama yo'llari) chaqirildi: **30/30 → 200**.

### 3.2.1 UI sahifalari (brauzerda ochib ko'rildi)

15 ta marshrut ochildi — **15/15 xatosiz**, "Server xatosi"/"yuklanmadi" holati yo'q:
Bosh sahifa, Xodimlar, Bo'limlar, Lavozimlar, Davomat, Monitoring, Smenalar, Ta'tillar, Bayramlar, Hisobotlar, Qurilmalar, Foydalanuvchilar, Audit, Sozlamalar, Zaxira nusxalari.
Brauzer konsolida JS xatosi yo'q.

### 3.3 Rollar matritsasi (jonli tekshiruv)

| Rol | Bo'limlar ko'rinishi | Davomat | Yozish (xodim qo'shish) |
|---|---|---|---|
| Super Admin | 9 (hammasi) | 200 | ✅ 201 |
| Direktor | 9 (hammasi) | 200 | ⛔ 403 |
| Bosh shifokor | 9 (hammasi) | 200 | ⛔ 403 |
| Bo'lim boshlig'i | **1 (faqat o'zi)** | 200 | ⛔ 403 |
| Kadrlar boshlig'i (HR) | 9 | 200 | ✅ 201 |
| Kuzatuvchi/Auditor | 9 | 200 | ⛔ 403 |

Bo'lim boshlig'i boshqa bo'lim xodimini so'rasa → **404** (ID enumeratsiyasining oldini olish uchun ataylab).

### 3.4 Xavfsizlik

**SQL injection — bardosh beradi.** Backend to'liq SQLAlchemy ORM (parametrlangan so'rovlar) orqali ishlaydi, raw SQL interpolatsiyasi yo'q. 8 xil payload (`' OR '1'='1`, `'; DROP TABLE users; --`, `1' UNION SELECT NULL--` va h.k.) login, qidiruv va filtr parametrlariga yuborildi: 500 xato yo'q, ma'lumot oqimi yo'q, sonli maydonlar 400/422 bilan rad etildi.

**XSS — bardosh beradi.** Frontendda `dangerouslySetInnerHTML` / `innerHTML` / `eval` ishlatilmagan; React qiymatlarni escape qiladi. Bo'lim nomiga `<img onerror=...><script>...</script>` saqlab tekshirildi: DOM'da 0 ta `script`/`img` elementi, `window.__xss` — `undefined`.

**Headerlar:** `Content-Security-Policy` (API uchun `default-src 'none'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `X-XSS-Protection`.
**Brute-force:** 5 marta noto'g'ri urinishdan keyin `429` (5 urinish / 300 s).

### 3.5 Tuzatilgan muammolar (shu tekshiruv davrida)

1. **Qidiruv/filtr/sahifalash** — `total` CROSS JOIN tufayli noto'g'ri sanalardi (4 ta test yiqilardi).
2. **Email majburiyligi** — bo'lim boshlig'i yaratishda bo'sh email 500 berardi; endi ixtiyoriy, bo'sh bo'lsa `login@facesys.local` yasaladi.
3. **Soft-delete + UNIQUE** — o'chirilgan hisob logini/emailini abadiy band qilardi; qismiy unikal indekslarga o'tildi (migratsiya `0003`).
4. **Huquq oshirish** — HR rol bera olardi; endi faqat Super Admin.
5. **Bo'lim boshlig'i ko'rinmasdi** — ro'yxatga "Bo'lim boshlig'i" ustuni qo'shildi.
6. **O'chirilgan xodim boshliq bo'lib qolardi** — endi avtomatik bo'shatiladi.
7. **API CSP** yumshatilgan edi (`unsafe-inline`, CDN) — qattiqlashtirildi.
8. **Monitoring sahifasida React ogohlantirishi** (`<option selected>`) — tuzatildi.

---

## 4. Demo (test) uchun ko'rsatish rejasi — 10 daqiqa

**Tayyorgarlik (5 daqiqa, oldindan):**
1. Kirish: `admin` / `FaceSys-Admin-2026!`
2. *Bo'limlar* → 3–4 ta bo'lim (masalan: Terapiya, Jarrohlik, Laboratoriya, Ma'muriyat) va har biriga boshliq xodim biriktirish.
3. *Xodimlar* → "Tezkor qo'shish" bilan 10–15 xodim (bo'limlar bo'yicha).
4. *Foydalanuvchilar* → 4 ta hisob: direktor, bosh shifokor, bo'lim boshlig'i (bitta bo'limga), kadrlar.

**Ko'rsatish ssenariysi:**
1. **Admin** — Bosh sahifa: ko'rsatkichlar, 14 kunlik grafik.
2. **Xodim + bo'lim** — xodim qo'shish, bo'limga biriktirish, boshliq tayinlash.
3. **Foydalanuvchi** — bo'lim boshlig'i hisobini ochish → login/parol bir marta ko'rsatiladi.
4. **Bo'lim boshlig'i** sifatida kirish → faqat o'z bo'limi ko'rinadi (boshqa bo'limga o'tib bo'lmaydi).
5. **Direktor** sifatida kirish → barcha bo'limlar davomati va hisobotlar, lekin tahrirlash yo'q.
6. **Davomat** — bo'lim bo'yicha filtr, davomat yozuvi, qo'lda tuzatish (audit jurnalida kuzatiladi).
7. **Audit jurnali** — har bir muhim amal yozilgani.
8. **Zaxira nusxalari** — backup yaratish.

**Ko'rsatib bo'lmaydigan qism:** terminal bilan real yuz skaneri, tashqi HTTPS manzil.

---

## 5. Cheklovlar (halol ro'yxat)

| Band | Holat |
|---|---|
| Hikvision DS-K1T343MWx bilan real sinov | Yo'q — qurilma kerak |
| HTTPS/TLS | Yo'q — sertifikat/domain kerak |
| Backup → restore mashqi | Yo'q — alohida host kerak |
| Yuklama testi (1000 xodim) | O'tkazilmagan |
| Kutubxona zaifliklari (`pip-audit`, `npm audit`) | O'tkazilmagan |
| Standart admin paroli | Almashtirilishi kerak |

---

## 6. Sig'im: nechta xodimning Face ID'sini ishlatish mumkin

**Asosiy xulosa:** server tomonda amaliy chegara yo'q — haqiqiy chegara **terminalning o'zida**. Tizim yuzni serverda tanimaydi: terminal tanidi, server faqat hodisani qabul qiladi va xodim ↔ qurilma ID bog'lanishini saqlaydi (yuz shabloni serverga yuborilmaydi — bu ataylab, biometrik ma'lumot saqlanmaydi).

### 6.1 Terminal chegarasi (Hikvision rasmiy datasheet)

| Parametr | Qiymat |
|---|---|
| Yuzlar (faces) | **maks. 1500** |
| Kartalar | 3000 |
| Foydalanuvchilar | 3000 |
| Hodisalar (events) | 150 000 |

Manba: <https://www.hikvision.com/en/products/Access-Control-Products/terminals/face-recognition-terminal/ds-k1t343mwx/>

### 6.2 Server chegarasi (o'lchangan, 2026-10-29)

Test bazasida 1000 xodim yaratilib, so'rov vaqtlari o'lchandi (PostgreSQL 17, lokal):

| Amal | Vaqt |
|---|---|
| 1000 xodimni bulk yozish | 192 ms (0.19 ms/xodim) |
| Sahifa (LIMIT 20, tartiblash) | **0.67 ms** |
| Umumiy COUNT | 0.23 ms |
| Qidiruv (`ILIKE '%...%'`) | 1.02 ms |
| Bo'lim filtri + sahifa | 0.20 ms |

**Hodisalar oqimi:** 1000 xodim × 2 skan/kun = 2000 hodisa/kun ≈ 730 ming/yil (indekslar bilan ~300–500 MB/yil).

### 6.3 Amaliy tavsiya

| Savol | Javob |
|---|---|
| Test/demo uchun qancha xodim? | 300–1000 |
| Bitta terminalga nechta yuz? | 1500 (qattiq chegara) |
| 50 bo'lim bo'lsa? | Har terminalga faqat o'sha bo'lim xodimlari (20–30 kishi) — chegaraga yaqinlashmaydi |
| Serverga qancha? | 10 000+ xodim muammosiz |

**Amaliy nuance:** 1000 xodimni har bir terminalga yozish shart emas — har eshik terminaliga o'sha bo'lim xodimlari yetarli.
**Vaqt chegarasi:** yuzni terminalda qo'lda yozish ~20–30 s/kishi (1000 kishi ≈ 8–10 soat); ommaviy yozish uchun Hikvision'ning o'z dasturi (iVMS/Client) ishlatiladi.
**Bitta worker cheklovi:** poller app lifespan'da ishlagani uchun uvicorn bitta worker bilan ishlaydi — bir vaqtda 20–50 foydalanuvchi uchun mo'ljallangan (klinika uchun yetarli).

---

## 7. Ishga tushirish (lokal)

```bash
# Backend
cd backend
.venv/Scripts/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# Frontend
cd frontend
npm run dev        # http://127.0.0.1:5173
```

Ma'lumotlar bazasi: PostgreSQL `localhost:5432`, DB `facesys`.
Zaxira: `backups/facesys_<sana>.dump` (`pg_dump -Fc`).
