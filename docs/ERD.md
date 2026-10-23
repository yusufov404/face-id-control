# FaceSys Enterprise — ER Diagram & Ma'lumotlar modeli

## ER Diagram (Mermaid)

```mermaid
erDiagram
    DEPARTMENTS ||--o{ EMPLOYEES : "department_id"
    DEPARTMENTS ||--o{ POSITIONS : "department_id"
    DEPARTMENTS ||--o{ DEVICES : "department_id"
    DEPARTMENTS ||--o{ USERS : "department_id"
    DEPARTMENTS }o--o| EMPLOYEES : "head_employee_id"

    POSITIONS ||--o{ EMPLOYEES : "position_id"
    EMPLOYEES ||--o{ EMPLOYEES : "supervisor_id"

    USERS }o--|| EMPLOYEES : "employee_id"
    USERS ||--o{ USER_ROLES : "user_id"
    ROLES ||--o{ USER_ROLES : "role_id"
    ROLES ||--o{ ROLE_PERMISSIONS : "role_id"
    PERMISSIONS ||--o{ ROLE_PERMISSIONS : "permission_id"

    DEVICES ||--o{ DEVICE_EVENTS : "device_id"
    EMPLOYEES ||--o{ DEVICE_EVENTS : "employee_id"

    EMPLOYEES ||--o{ ATTENDANCE_RECORDS : "employee_id"
    ATTENDANCE_RECORDS }o--|| SHIFTS : "shift_id"
    ATTENDANCE_RECORDS ||--o{ ATTENDANCE_CORRECTIONS : "attendance_record_id"
    EMPLOYEES ||--o{ ATTENDANCE_CORRECTIONS : "employee_id"
    USERS ||--o{ ATTENDANCE_CORRECTIONS : "corrected_by"
    DEVICE_EVENTS }o--o| ATTENDANCE_RECORDS : "check_in/out_event_id"

    SHIFTS ||--o{ EMPLOYEE_SHIFT_ASSIGNMENTS : "shift_id"
    EMPLOYEES ||--o{ EMPLOYEE_SHIFT_ASSIGNMENTS : "employee_id"

    EMPLOYEES ||--o{ LEAVE_REQUESTS : "employee_id"
    USERS ||--o{ LEAVE_REQUESTS : "requested_by/approved_by"

    USERS ||--o{ AUDIT_LOGS : "user_id"
    USERS ||--o{ SYSTEM_SETTINGS : "updated_by"
```

## Jadval tavsiflari

| Jadval | Vazifasi | Asosiy kalitlar / Unikal |
|---|---|---|
| `departments` | Bo'limlar daraxti (parent_id) | `code`, `name` unikal |
| `employees` | Xodimlar; `internal_id` (ichki) va `device_user_id` (Hikvision) alohida | `internal_id`, `device_user_id` unikal |
| `positions` | Lavozimlar | `code`, `name` unikal |
| `users` | Tizim foydalanuvchilari | `username`, `email` unikal |
| `roles` | Rollar + cheklov bayroqlari | `name` unikal |
| `permissions` | Ruxsatlar katalogi | `name` unikal |
| `user_roles` | Foydalanuvchi–rol bog'lanishi | `(user_id, role_id)` unikal |
| `role_permissions` | Rol–ruxsat bog'lanishi | `(role_id, permission_id)` unikal |
| `devices` | Hikvision qurilmalari | `serial_number` unikal |
| `device_events` | Xom qurilma hodisalari (immutable-ish) | `(device_id, device_event_id)` unikal — idempotency |
| `attendance_records` | Kunlik hisoblangan davomat | `(employee_id, record_date)` unikal |
| `attendance_corrections` | Qo'lda tuzatishlar (audit bilan) | — |
| `shifts` | Smenalar, tungi smena bayrog'i | `code` unikal |
| `employee_shift_assignments` | Xodim–smena biriktirish (sana oralig'i) | — |
| `leave_requests` | Ta'til so'rovlari | — |
| `holidays` | Bayram/dam olish kunlari | `date` unikal |
| `audit_logs` | O'zgarmas audit jurnali | — |
| `system_settings` | Tizim sozlamalari (JSON) | `key` unikal |

## Muhim dizayn qarorlari

1. **Soft delete** — `employees`, `departments`, `positions`, `users`, `roles`, `shifts`, `attendance_records` va boshqalarda `is_deleted` + `deleted_at`. Xodim o'chirilganda davomat tarixi `ON DELETE CASCADE` emas — soft delete sababli saqlanadi. `device_events.employee_id` esa `SET NULL` — xom hodisa hech qachon yo'qolmaydi.

2. **Circular FK** — `departments.head_employee_id → employees.id` va `attendance_records.check_in_event_id → device_events.id` siklni oldini olish uchun jadval yaratilgandan keyin `ALTER TABLE ADD CONSTRAINT` bilan qo'shiladi.

3. **Idempotency** — `device_events` da `(device_id, device_event_id)` noyob kalit. Qurilma bir xil hodisani qayta yuborsa, `ON CONFLICT DO NOTHING`.

4. **Timezone** — barcha `DateTime` ustunlari `timezone=True` (TIMESTAMPTZ). Ilova darajasida `Asia/Tashkent` ga konvertatsiya qilinadi.

5. **Biometrika** — yuz shablonlari/rasmlar saqlanmaydi. Faqat `similarity` (float) va `verify_mode` saqlanadi.

6. **Audit immutability** — `audit_logs` uchun soft delete/updated_at yo'q; faqat INSERT (DB darajasida `REVOKE UPDATE/DELETE` tavsiya etiladi).

## Indekslar strategiyasi

- Qidiruv: `employees.name(last_name, first_name)`, `employees.internal_id`, `employees.device_user_id`
- Davomat: `attendance_records(record_date, status)`, `(employee_id, record_date)`
- Hodisalar: `device_events(employee_id, event_time)`, `(processed, event_time)`
- Audit: `audit_logs(user_id, timestamp)`, `(resource_type, resource_id, timestamp)`